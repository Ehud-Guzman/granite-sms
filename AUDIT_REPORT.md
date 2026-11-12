# Granite SMS — System Audit

**Date:** 11 Nov 2026 · **Scope:** whole repo (server, client, schema, migrations, infra, demo) · **Status:** findings only, nothing fixed yet

## Fix status (12 Nov 2026, branch `audit-wave-1`)

| Finding | Status | Commit |
|---|---|---|
| C1 concurrent payments | Fixed, tested | d36c8e8 |
| C2 backups | REPLACE restore off; nightly verified off-site dump ready (needs secrets) | 5f1e324 |
| C3 missing foreign keys | Fixed + drift check in CI | f21532d |
| C4, H1, H2 accounts and sessions | Fixed | 657546a |
| H3, H4 rate limits and lockout | Fixed | b5c329f |
| H5, H6, H7 fee controls | Fixed | 105bc37 |
| H8 CBC grading | **Open (Wave 3)** | |
| H9 frozen results | Fixed | 7975ae9 |
| H10 pagination | Fixed (8.8 MB / 4.6 s -> 18 KB / 35-143 ms) | 8e1e8a9 |
| H11 tests and CI | 113 tests, CI on every push | bdf4f5e, 12189be |
| H12 dependencies | Fixed except Prisma 7 / exceljs (see commit) | 11df972 |
| M1 | Fixed | 74bbeae |
| M2 attendance rules | Fixed | 6b4b792 |
| M3, M4 time zone, current term | Fixed | b013bb9 |
| M5 fee ledger, M15 student home | **Open (Wave 3)** | |
| M6 receipts | Fixed | 79cb5fd |
| M7, M8, M9 exams | Fixed | 7975ae9 |
| M10, M11, M12, M14 | Fixed | 5390697 |
| M13 data export | Fixed | d26b8bd |
| M16 logos, L7 | Fixed | 8464316 |
| M17 ops | Fixed (Sentry not added: needs a DSN) | 48ca4ee |
| L5 lint | Fixed | 12189be |
| L1-L4, L6, L8, L9 | Open | |
| Features 1, 7, 8 (guardians, promotion, import) | Built | 045b4e4, 7315d18, a4c130b |
| Features 2-6, 9-11 (SMS, M-Pesa, ledger, CBC, term report, parent portal...) | **Open (Wave 3)** | |

## How this was done

- Read every server route, middleware and service, the Prisma schema and all 22 migrations, plus the client's API layer, guards, fees, attendance, exams, dashboard and settings screens.
- Ran the API locally against a **throwaway Postgres container** (`granite_audit_db`, port 55432) seeded with the demo school: Mwangaza Academy, 212 students, 3 terms of fees, exams and attendance. Your Neon databases were not touched.
- Signed tokens for every role and attacked the API with curl: cross-school access, role escalation, concurrent payments, bad input, oversized bodies, lockout abuse, backup/restore.
- Scale test: added 9 more years of invoices (6,301 total) and re-timed the slow endpoints.
- Lint, production build, bundle sizes, `npm audit` on both apps.
- **Not done:** visual review in a browser (no browser tool here). UI findings come from reading the code.

Severity:
- **Critical:** loses or corrupts money or marks data, or lets one user take over another.
- **High:** a security hole or wrong results a school would notice quickly.
- **Medium:** correctness, UX or ops problems that hurt daily use.
- **Low:** cleanup.

Effort: **S** < half a day · **M** 1–3 days · **L** a week or more.

---

## Summary

| Severity | Count | Headline |
|---|---|---|
| Critical | 4 | Payments race and corrupt balances · backups miss all financial and academic data · database missing 6 foreign keys · one admin can take over another |
| High | 12 | Forced password change not enforced by the server · sessions can't be revoked · rate limits will lock out whole schools · bursar can reverse any payment · teachers see school finances · wrong grading system for CBC · results not frozen · invoice list 8.8 MB · no tests |
| Medium | 17 | Dates in UTC instead of Kenya time · no "current term" setting · no advance payments · bad input crashes with 500 · uploads lost on redeploy · … |
| Low | 9 | Duplicate middleware, three limit systems, lint errors, committed junk |

**What's solid (verified, not assumed):**
- **School isolation held:** 15 cross-school probes (students, classes, invoices, receipts, PDFs, statements, marksheets, attendance, results, backups, user edits, payments) were all refused.
- **Self-view limits work:** students can only see their own results and statement.
- **Teachers can't touch each other's marksheets.**
- **Auth basics are right:** a weak or missing `JWT_SECRET` stops the server, the token algorithm is pinned, helmet is on, CORS is an allowlist, and failed-login counting is atomic.
- **Uploads:** logo uploads force an image file extension.
- **Demo mode:** writes are blocked by HTTP method, and the server refuses to start unless the database name contains "demo".
- **Client:** the cashier screen sends an idempotency key, and the main bundle is 131 KB gzipped with lazy-loaded pages.

---

## Critical

### C1 · Concurrent payments corrupt the invoice balance and bypass the overpayment check — VERIFIED
[fees.js:1182-1241](server/src/routes/fees.js#L1182-L1241)

The payment transaction reads `invoice.paid`, adds the amount in JavaScript and writes it back. Postgres's default isolation (READ COMMITTED) doesn't stop two transactions reading the same old value.

**Test:** 5 simultaneous payments of KES 10,000 against a KES 17,000 invoice.

| | Result |
|---|---|
| Payments accepted | 4 (KES 40,000 recorded as received) |
| Invoice shows | paid 10,000, balance 7,000 |
| Overpayment check | bypassed |

The ledger no longer reconciles: the receipts total doesn't match the invoice, and the student is shown owing money already paid. This happens in practice with two cashiers, a double tap on a slow connection, or a cash payment and an M-Pesa confirmation arriving together. Payment reversal ([fees.js:1282-1327](server/src/routes/fees.js#L1282-L1327)) has the same pattern.

**Fix (M):**
- Lock the invoice row inside the transaction (`SELECT … FOR UPDATE` via `$queryRaw`), or use a conditional atomic update: `updateMany({ where: { id, balance: { gte: amt } }, data: { paid: { increment: amt }, balance: { decrement: amt } } })` and fail when `count === 0`.
- Better long-term: treat `paid` and `balance` as values derived from the payment rows, recompute them inside the transaction, and add a nightly reconciliation check.
- Add a concurrency test for this.

### C2 · "Backups" don't back up the school, and REPLACE restore can't work — VERIFIED
[backup.service.js:67-115](server/src/services/backup.service.js#L67-L115), [backup.service.js:205-224](server/src/services/backup.service.js#L205-L224)

- **Contents:** the snapshot holds users, teachers, classes, students, subjects, assignments, settings and subscription only. It has **no invoices, payments, marks, exam sessions, results or attendance**, which is everything a school can't recreate.
- **Storage:** snapshots sit in the `Backup` table of the **same database**. If the database is lost, the backups go with it.
- **REPLACE restore fails:** on Mwangaza it was refused by the `ExamSession_classId_fkey` foreign key. Any school with exams or fees can't be restored this way.
- **REPLACE restore also:**
  - gives every user a new random password ([backup.service.js:382-400](server/src/services/backup.service.js#L382-L400)), locking all staff out;
  - wipes students. Because of C3, their invoices and attendance would be left pointing at deleted students.
- **MERGE restore** overwrites existing users' roles from the old snapshot, which can re-promote someone who was demoted, and forces every user to change their password.

**Fix:**
- **(S) now:** disable REPLACE restore in the UI and API.
- **(M):** use real database backups: Neon point-in-time restore plus a scheduled `pg_dump` to off-site storage (R2 or S3) with a restore drill.
- **(M–L):** keep the in-app snapshot only as a per-school "export my data" feature that covers every table.

### C3 · The migrations don't match the schema: 6 foreign keys and 2 indexes are missing — VERIFIED
`npx prisma migrate diff --from-url <db built by migrate deploy> --to-schema-datamodel prisma/schema.prisma` reports:

| Missing in the database | Effect |
|---|---|
| `FeeInvoice.studentId → Student` | invoices can point to deleted or nonexistent students |
| `FeeInvoice.classId → Class` | same, for classes |
| `FeePlan.classId → Class` | |
| `AttendanceSession.classId → Class` | |
| `AttendanceRecord.studentId → Student` | |
| `MarkSheet.teacherId → Teacher` | |
| `User(schoolId, role)`, `User(schoolId, isActive)` indexes | slower user and limit counts |

The schema says `onDelete: Restrict`, so the code assumes the database will block deleting a student who has invoices. A database built from these migrations, which is what Docker and `migrate deploy` on Render do, won't block it. **Your production Neon database is very likely the same.** Check without changing anything:

```sh
cd server
npx prisma migrate diff --from-url "$PROD_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

**Fix (S–M):**
1. Run an orphan check, e.g. `SELECT count(*) FROM "FeeInvoice" i LEFT JOIN "Student" s ON s.id = i."studentId" WHERE s.id IS NULL`, for each relation.
2. Clean up any orphans.
3. Create a migration with `prisma migrate dev --create-only` for the missing constraints.
4. Add the `migrate diff` command to CI so drift fails the build.

### C4 · One school admin can take over another admin's account — VERIFIED
[users.js:308-405](server/src/routes/users.js#L308-L405), [users.js:516-581](server/src/routes/users.js#L516-L581)

The only protection is for `SYSTEM_ADMIN` targets. An `ADMIN` can change a fellow `ADMIN`'s email, set their password and demote them. **Tested:** changed a deputy admin's email to `attacker@evil.invalid`, set the password to a known value, and signed in as them.

An admin can also pick a password for any staff member, so they know it until it's changed. Because of H1, that "temporary" password works indefinitely.

**Fix (S):**
- ADMIN can't edit, reset, suspend or demote another ADMIN; only SYSTEM_ADMIN can.
- Password resets always generate a password instead of accepting one from the caller.
- Changing the email of an admin account requires a second admin or the platform owner.

---

## High

| ID | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|
| **H1** | **"Must change password" is only enforced in the browser.** An account flagged for a password change can call every API normally. **Verified:** a flagged user got 200 from `/api/dashboard/summary`. | [AuthGuard.jsx:31](client/src/guards/AuthGuard.jsx#L31), [tenant.js](server/src/middleware/tenant.js) | In `tenantContext`, if `mustChangePassword`, allow only `/api/me` and `/api/auth/change-password`; everything else returns 403 `PASSWORD_CHANGE_REQUIRED`. | S |
| **H2** | **Sessions can't be revoked.** Tokens last 7 days ([jwt.js](server/src/utils/jwt.js)), are kept in `localStorage` and there is no server-side logout. A password reset, password change or detected compromise doesn't end existing sessions. Impersonation tokens look identical to real ones, so actions taken while impersonating are logged as the target user. | [jwt.js](server/src/utils/jwt.js), [auth.api.js](client/src/api/auth.api.js) | Add `tokenVersion` to User and to the token; bump it on password change, reset or deactivation, and check it in `tenantContext`, which already loads the user. Shorten the lifetime to 8–12 hours with silent refresh. Add an `impersonatedBy` claim and log it. | M |
| **H3** | **Rate limits are per IP, but a school is one IP.** Staff share the school's internet connection. The auth limit of 30 per 15 minutes covers *every* `/api/auth/*` call, including password changes and school switching. A staff room of 30+ signing in on Monday morning gets "Too many auth attempts". The 300 requests/minute global limit is reachable with a few teachers entering marks. | [index.js:116-133](server/index.js#L116-L133) | Key the login limiter on email + IP, apply it only to `/login`, and raise the global limit or key it per user once authenticated. | S |
| **H4** | **Anyone can lock any staff account, and lockouts repeat.** Five wrong passwords lock any email for 30 minutes, so a student can lock the bursar out on fee day. After the lock expires the failure counter isn't reset, so **one** more wrong password locks it for another 30 minutes (**verified**: counter at 6, locked again). The "Account temporarily locked" reply ([auth.js:193](server/src/routes/auth.js#L193)) also confirms which emails have accounts. | [auth.js:182-230](server/src/routes/auth.js#L182-L230) | Reset the counter when a lock expires. Return the same generic message for locked accounts. Back off progressively per email + IP rather than a hard lock. Alert the admin when lockouts happen. | S |
| **H5** | **A bursar can reverse any payment with no approval.** **Verified** with a 200 response. Combined with cash handling, this is the classic school fraud: take cash, issue a receipt, reverse it later, keep the money. | [fees.js:1271-1274](server/src/routes/fees.js#L1271-L1274) | Reversals by ADMIN only, or a bursar request that an admin approves. Show reversals prominently on the admin dashboard and the daily cash report. | S–M |
| **H6** | **Teachers' dashboard shows the whole school's finances.** **Verified:** a teacher sees `collectedToday: 86,300`, `outstandingTotal: 17,691,000` and invoice counts, though they're blocked from the Fees module. Attendance and exams widgets are scoped for teachers; the fees block isn't. | [dashboard.service.js:136-241](server/src/modules/dashboard/dashboard.service.js#L136-L241) | Leave out the `fees` block unless the role is ADMIN or BURSAR. | S |
| **H7** | **Invoices can be generated from the wrong fee plan.** `/invoices/generate` doesn't check that the plan's class, year and term match the request, that the student is in that class, or that the plan is active. **Verified:** created a 2029 Term 3 invoice for a Grade 4 student from another class's 2026 Term 1 plan. Bulk generation has the same gaps. | [fees.js:628-690](server/src/routes/fees.js#L628-L690), [fees.js:692-716](server/src/routes/fees.js#L692-L716) | Take class, year and term from the plan, require `plan.isActive`, and check that `student.classId === plan.classId`. | S |
| **H8** | **Grading is hard-coded to 8-4-4 (A to E) and doesn't fit CBC classes.** The demo school is Grade 4–9, where CBC uses EE / ME / AE / BE. The `GradeScale` and `GradeBand` tables exist but nothing uses them. `ExamType.weight` is stored but never applied. Scores are always out of 100. There is no term report that combines CAT, mid-term and end-term. | [exams.grades.js](server/src/modules/exams/exams.grades.js), [exams.services.js:90-101](server/src/modules/exams/exams.services.js#L90-L101) | Make grade scales per school and per level, configurable in Settings (CBC rubric, KCSE bands), and use the existing tables. Add `outOf` per marksheet. Add a term report that combines exam types by weight. | L |
| **H9** | **Published results aren't frozen and can't be corrected properly.** Results are recalculated from marks on every read ([exams.services.js:823-916](server/src/modules/exams/exams.services.js#L823-L916)). Deactivating, transferring or adding a student after publishing changes printed positions retroactively; reads even create blank mark rows for new students, who then appear as "missing". After publishing nothing can be fixed: unlock is blocked ([exams.services.js:714](server/src/modules/exams/exams.services.js#L714)), so a wrong mark stays wrong permanently. | as linked | Save a snapshot of results at publish time (the `StudentResult`, `SubjectResult` and `ResultPublish` tables already exist, unused). Add "unpublish for correction" for ADMIN with a reason, audit trail and republish. | M |
| **H10** | **The invoice list has no size limit.** `GET /api/fees/invoices` returns every invoice with lines and payments. **Measured:** 630 invoices → 1.1 MB in 0.3–0.8 s; 6,301 invoices → **8.8 MB in 4.1–4.6 s** server time. A 1,500-student school passes 6,000 invoices in about 18 months. The UI filters by term, which helps until a school is large. | [fees.js:559-597](server/src/routes/fees.js#L559-L597) | Server-side pagination (`take` / `cursor`) and search; return lines and payments only on the detail endpoint. Apply the same to students, users and attendance sessions. | M |
| **H11** | **No automated tests and no CI checks.** This code handles money and exam results. The only workflow refreshes the demo. Several earlier fixes in git history ("second-pass audit") are exactly what regression tests would catch. | — | Start with API integration tests (Vitest + Supertest against a throwaway Postgres) for payments (including concurrency), discounts, reversals, results ranking and tenant isolation. Run lint, tests and `migrate diff` in GitHub Actions on every push. | M |
| **H12** | **Vulnerable dependencies.** Server: `proxy-addr` (**critical**, IP spoofing; matters because `trust proxy` is on), `body-parser`, `multer`, `brace-expansion`, `deepmerge-ts` (high, mostly denial of service), `qs`, `exceljs`, `uuid`. Client: `axios`, `follow-redirects`, `react-router`, `zod`, `nanoid` (high). | `npm audit --omit=dev` | Run `npm audit fix` in both apps, re-run the build and tests, and enable Dependabot. | S |

---

## Medium

| ID | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|
| M1 | **Bad input crashes with a 500 instead of a 400.** **Verified** on: invalid term or status filter on invoices; the collections report without dates (`parseDateRange` throws `e.status = 400` but the route returns 500); a 2 MB body (should be 413). | [fees.js:1757](server/src/routes/fees.js#L1757), [index.js:259](server/index.js#L259) | Validate enums at the edge (zod is already a client dependency, so share the schemas). In the global error handler, respect `err.status` / `err.statusCode` and `type === 'entity.too.large'`. | S |
| M2 | **Attendance accepts any date and any year/term.** **Verified:** a teacher created a register for 25 Dec 2031 labelled year 2000. Backdating is unlimited. New registers start with everyone **PRESENT**, so a register submitted without marking shows 100% attendance. There is no school calendar (term dates, holidays). | [attendance.validators.js:14](server/src/modules/attendance/attendance.validators.js#L14), [attendance.service.js](server/src/modules/attendance/attendance.service.js) | Reject future dates. Derive year and term from a school calendar. Limit how far back teachers can go (admins can override). Start records unmarked and require every student marked before submitting, or keep "all present" as one explicit button. | M |
| M3 | **Dates use UTC, but Kenya is UTC+3.** "Collected today", collections reports and receipt-number dates all use UTC midnight. Payments made 00:00–02:59 EAT (common for late-night M-Pesa) count on the previous day, so the daily cash-up won't match the till. Client defaults like `new Date().toISOString().slice(0,10)` have the same problem. | [fees.js:126](server/src/routes/fees.js#L126), [AttendancePage.jsx:58](client/src/features/attendance/AttendancePage.jsx#L58), [FeesDashboardTab.jsx:12](client/src/features/fees/tabs/FeesDashboardTab.jsx#L12) | Add a school `timezone` setting (default `Africa/Nairobi`) and calculate day boundaries in it, server and client. | S–M |
| M4 | **No "current term" setting.** Settings store `currentAcademicYear` but not a current term. 10 screens default to `TERM1`, so in Term 3 every bursar opens the wrong invoices first. | [InvoicesTab.jsx:37](client/src/features/fees/tabs/InvoicesTab.jsx#L37) | Add `currentTerm` (or term dates) to SchoolSettings, expose it on `/api/me`, and default every filter to it. | S |
| M5 | **Fees can't handle real parent behaviour.** Overpayment is rejected ([fees.js:1209](server/src/routes/fees.js#L1209)), so a parent who pays ahead or over can't be recorded. Only one invoice per student per term is allowed (`@@unique([schoolId, studentId, year, term])`), so a trip, uniform or exam fee mid-term needs a workaround. Arrears from last term aren't carried forward. | schema.prisma:474 | Add a student ledger with credit balance and allocation (FIFO across invoices), allow extra charges as supplementary invoices or debit notes, and carry balances into the new term. | L |
| M6 | **Receipts don't meet audit expectations.** The PDF prints the cashier's user **ID** as "Received By" ([fees.js:1470](server/src/routes/fees.js#L1470)). Invoice and receipt numbers are random hex ([fees.js:83-94](server/src/routes/fees.js#L83-L94)); auditors and parents expect sequential numbers per school with no gaps. A rare collision returns a 500 instead of retrying. | as linked | Show the staff member's name. Generate sequential numbers per school and year (a counter row updated inside the payment transaction). | S |
| M7 | **Teacher access rules differ between modules.** Attendance and exams let a subject teacher (via TeachingAssignment) into a class, but the students list only honours class-teacher links ([students.js:219-244](server/src/routes/students.js#L219-L244)). A subject-only teacher sees an empty "My Students". | as linked | One shared `teacherClassIds()` helper used by every module. | S |
| M8 | **Any teacher can take over an unassigned marksheet.** When `MarkSheet.teacherId` is null, any teacher in the school can open, claim and fill it, even for a class they don't teach. | [exams.services.js:103-124](server/src/modules/exams/exams.services.js#L103-L124), [exams.services.js:443](server/src/modules/exams/exams.services.js#L443), [exams.services.js:764](server/src/modules/exams/exams.services.js#L764) | Allow claiming only when the teacher has a TeachingAssignment for that class and subject. | S |
| M9 | **Read requests write to the database.** Marksheet and results reads backfill mark rows ([exams.services.js:78-86](server/src/modules/exams/exams.services.js#L78-L86), [exams.services.js:845](server/src/modules/exams/exams.services.js#L845)). Results cost 100–460 ms because each subject's sheet runs 2–3 queries. Viewing a statement, summary or receipt writes an audit row. In demo mode this means writes from visitors who are only reading. | as linked | Create mark rows when a student joins a class (or once at publish), not on read. Log "viewed" events only for sensitive exports, or sample them. | S–M |
| M10 | **Users and schools are cached in memory for 30 s.** Role changes and deactivations take up to 30 s to apply, and longer with more than one server instance (each has its own cache). | [tenant.js:22-34](server/src/middleware/tenant.js#L22-L34) | Clear the cache on user update, or fold this into the H2 `tokenVersion` check. Move to Redis if you run more than one instance. | S |
| M11 | **The API address is configured in two ways.** Most of the client reads `VITE_API_URL`; `client/.env` defines `VITE_API_BASE_URL`, which only Backups uses. In production, backup downloads would call `http://localhost:5000`. | [axios.js:5](client/src/api/axios.js#L5), [BackupsTab.jsx:73](client/src/features/settings/backup/BackupsTab.jsx#L73) | Use one variable through the shared `api` instance. Add `client/.env.example`. | S |
| M12 | **Local `.env` points at a cloud Neon database** (`neondb` on the pooler). `npm run dev` or `prisma:seed` on your laptop writes to it. `seed.js` only refuses when `NODE_ENV=production`. | server/.env | Use the Docker Postgres locally. Make seeds refuse any non-local host unless given an explicit flag. | S |
| M13 | **Only the platform owner can back up or export data.** A school admin can't download their own data, which they'll ask for (and the Data Protection Act gives them the right to). | [backup.routes.js](server/src/routes/settings/backup.routes.js) | Comes with the C2 rework: an ADMIN-scoped "export school data" (CSV or XLSX per module). | M |
| M14 | **The audit log's IP address can be faked.** It reads the client IP from the raw `X-Forwarded-For` header, which any caller can set. | [audit.js:93](server/src/utils/audit.js#L93) | Use `req.ip` (already proxy-aware via `trust proxy`). | S |
| M15 | **The student experience is thin and partly broken.** Students get the admin dashboard layout; `/dashboard/summary` returns 403 for them, so they see zeros and a "Partial" label. They can't see their own attendance (403). | [Dashboard.jsx](client/src/pages/Dashboard.jsx) | Build a student or parent home: balance, latest results, attendance %, notices. | M |
| M16 | **Uploads are stored on the server's local disk.** On Render (and in Docker without a volume) that disk is wiped on every deploy, so school logos disappear and printed letterheads break. | [branding.routes.js:154](server/src/routes/settings/branding.routes.js#L154) | Store uploads in object storage (Cloudflare R2 fits, since the demo is already on Cloudflare) and save the URL. | S–M |
| M17 | **Operations basics are missing.** Logging is console-only, and the request logger also runs in production. There is no error tracking. `/health` doesn't check the database. There is no graceful shutdown (`SIGTERM` → `prisma.$disconnect()`) and no production Dockerfile (only `Dockerfile.dev`). Invalid data is accepted: free-text gender, birth dates in 2099 (**verified**). | [index.js](server/index.js) | Use pino with request IDs and Sentry (free tier). Add `/health/ready` with `SELECT 1`. Add shutdown hooks, a production Dockerfile, and enums and date ranges on student fields. | M |

---

## Low

| ID | Finding | Fix |
|---|---|---|
| L1 | Three overlapping limit and entitlement systems ([subscription.js](server/src/middleware/subscription.js), [limits.js](server/src/middleware/limits.js), [entitlements.js](server/src/middleware/entitlements.js)). They return different status codes (402 / 403 / 409) for the same situation, and count teachers differently (with and without the `isActive` filter). The FREE plan defaults are defined in three places with different numbers. | Merge into one module that takes values from `config/plans.js`. |
| L2 | `requireAuth` + `tenantContext` run twice on `/api/exams`, `/api/attendance`, `/api/reports` and `/api/dashboard` (once in [index.js:175](server/index.js#L175), again in each router), doubling database lookups. | Remove the per-router copies. |
| L3 | Exams code takes the school from `req.user.schoolId`; everything else uses `req.schoolId`. Safe today only because SYSTEM_ADMIN can't reach exams. | Use `req.schoolId` everywhere. |
| L4 | `server/src/routes.zip` and uploaded logos (`uploads/`, `server/uploads/`) are committed to git. | Delete them and add both upload folders to `.gitignore`. |
| L5 | Lint: 2 errors and 11 warnings (mostly `exhaustive-deps`, which can cause stale data). | Fix and run lint in CI. |
| L6 | The client sends an `x-role` header the server ignores. It gives a false sense of security. | Remove it. |
| L7 | Logo uploads trust the browser's MIME type. The extension is forced to `.png` and `nosniff` is set, so this isn't exploitable, but the content isn't checked. | Check magic bytes with `file-type`. |
| L8 | Login skips bcrypt for unknown emails, so response timing reveals which emails exist. | Compare against a dummy hash when the user isn't found. |
| L9 | `fees.js` is 1,836 lines in one file: routes, money logic, PDF generation and reports mixed together. That's hard to review and test, which is why C1 survived several audits. | Split into `fees/{items,plans,invoices,payments,receipts,reports}.js` plus a `fees.service.js` holding the money logic. |

---

## Privacy and compliance (Kenya Data Protection Act, 2019)

The system stores data about children: names, dates of birth, class, attendance, results, and soon guardian phone numbers. That's regulated data. This section isn't legal advice, but these are the gaps a school's procurement or an inspector would raise:

- **Parental consent (s.33, children's data):** there's nowhere to record consent or its date.
- **Registration:** schools register as data controllers with the ODPC; GlimmerInk as the hosting provider is a data processor. You'll need a data-processing agreement template for schools.
- **Data subject rights:** no per-student "export everything" and no proper delete or anonymise for alumni. Students can only be deactivated.
- **Retention:** no retention rules for audit logs, attendance edit logs or former students.
- **Breach readiness (72-hour notification, s.43):** no monitoring or alerting (see M17) and no record of who exported what. Backup downloads are logged, but report exports aren't consistently.
- **Security measures:** backup files download as plain JSON with all student records. They should be encrypted or at least access-logged and expiring.

**Effort:** consent fields plus a student export plus a retention job is M. Policy documents are outside the code.

---

## Missing features a Kenyan school will expect (ranked by value ÷ effort)

| # | Feature | Why it matters | Effort |
|---|---|---|---|
| 1 | **Parents/guardians** (name, phone, relationship, multiple per student, siblings linked) | Nothing else on this list works without it. The Student table currently has no contact details at all. | S–M |
| 2 | **SMS notifications** (e.g. Africa's Talking): fee reminders, payment confirmations, absence alerts, results released | The single most-asked-for feature in Kenyan school systems. Parents rarely log in. | M |
| 3 | **M-Pesa Daraja**: paybill C2B confirmation with automatic matching by admission number, plus STK push | Removes most of the bursar's manual work and fixes reconciliation. Needs C1 fixed first. | L |
| 4 | **Student fee ledger**: arrears carried forward, credits and advances, supplementary charges, sequential receipts, daily cash book per cashier | See M5 and M6. Bursars run their day on this. | L |
| 5 | **CBC assessment + report cards** (rubric levels, learning areas, teacher comments) alongside 8-4-4/KCSE for secondary | See H8. Without it, CBC schools can't produce official report cards. | L |
| 6 | **Term report card** combining CAT + mid-term + end-term by weight, with class position "out of N" and comments | What parents actually receive | M |
| 7 | **Academic calendar + end-of-year promotion**: term dates, holidays, bulk promotion, graduation/alumni, transfers with a leaving certificate | Students currently have to be moved class by class, one at a time | M |
| 8 | **Bulk import of students** (CSV/Excel with validation preview) | Onboarding a 1,000-student school by hand isn't realistic | S |
| 9 | **Parent portal** (balance, statements, results, attendance), mobile-first | Turns SMS links into self-service | M |
| 10 | **Notices / communication log** | | S |
| 11 | Later: timetable, discipline records, library, transport, staff HR and payroll | | L each |

---

## Fix plan

**Wave 1: before any real school uses it (about 1.5–2 weeks)**
- C1 (payment locking) + a concurrency test
- C3 (migration fix, after checking production with the command above)
- C4, H1, H3, H4, H5, H6, H7 (these are mostly small)
- C2: disable REPLACE restore now; set up Neon point-in-time restore plus an off-site `pg_dump`
- H2 (`tokenVersion` + shorter tokens)
- H12 (`npm audit fix`) and M1 (proper 400s)
- H11: test harness covering fees, results and tenant isolation, and CI with lint + tests + `migrate diff`

**Wave 2: product-ready (3–4 weeks)**
- H9, H10, M2–M4, M6–M11, M14, M16, M17
- Features 1 (guardians), 7 (calendar + promotion), 8 (bulk import)
- School data export (M13)

**Wave 3: competitive**
- H8 + feature 5 (CBC), features 2 (SMS), 3 (M-Pesa), 4 (ledger), 6 (term report), 9 (parent portal)
- M5, M15, privacy tooling, the Low items as you touch each file

---

## Carried over and not verified here

- From the demo build session: the live Render database was seeded with your real platform-owner password. Confirm you've changed it.
- C3 on production: run the read-only `migrate diff` command above.
- UI visuals, responsiveness and accessibility need a pass in a browser. Signs from the code:
  - the sidebar collapses to a menu on mobile;
  - 11 screens use tables, and 14 files wrap content in horizontal scroll;
  - only 12 `aria-` attributes across the whole client;
  - 5 `<img>` tags without `alt`.

  Screenshots of each role's main screens on a phone would let me finish this part.

## Test environment left behind

- Docker container `granite_audit_db` (Postgres 16, port 55432) holds the seeded test school plus the junk the tests created. Remove it with `docker rm -f granite_audit_db`.
- Test scripts (`r.sh`, `tokens.mjs`) are in the session scratchpad, not the repo.
