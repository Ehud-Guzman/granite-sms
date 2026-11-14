# Granite SMS: Audit 2 Plan

**Written:** 13 Nov 2026 · **Covers:** everything in the repo (server, client, schema, migrations, CI, Docker, demo, docs) plus the deployed environments · **Output:** `AUDIT_REPORT_2.md`, a test for every verified finding, and the fixes in waves

Audit 1 (`AUDIT_REPORT.md`, 11 Nov) found 42 issues and fixed nearly all of them. This plan doesn't repeat that audit. It does three things:

1. **Proves the Audit 1 fixes still hold** by re-running the original attacks rather than trusting the status table.
2. **Covers the areas Audit 1 skipped or only touched**: frontend security, running more than one server instance, background jobs, accessibility, onboarding, the SaaS business layer, maintainability and performance at real school sizes.
3. **Sets a launch gate**: a short list of things that must be true before the first paying school goes live.

---

## 0. Ground rules

These apply to every finding, so the report stays useful and nothing is padded.

- **Verified or labelled.** Each finding is either **VERIFIED** (reproduced, with the request, response or screenshot) or **SUSPECTED** (from reading the code, with the reason it wasn't reproduced). Style preferences don't count as findings.
- **Every finding has:** file and line, how to reproduce it, impact in school terms ("the bursar sees X", "a parent can Y"), the fix, effort, and the test that will guard it.
- **Same scales as Audit 1.**
  - Severity: **Critical** loses or corrupts money or marks, or lets one user take over another. **High** is a security hole or wrong results a school would notice. **Medium** hurts daily use. **Low** is cleanup.
  - Effort: **S** is under half a day, **M** is 1 to 3 days, **L** is a week or more.
- **IDs:** `A2-<area>-<n>`, for example `A2-SEC-04`. Areas: `REG` regression, `SEC` security, `DATA` data and logic, `PERF` performance, `OPS` reliability and ops, `UX` user experience, `A11Y` accessibility, `CODE` maintainability, `SAAS` product and compliance.
- **Nothing touches real data.** All testing runs against a throwaway Postgres seeded with the demo school, plus a scaled seed (see 2.3). Production gets read-only checks only, and you run those yourself.
- **Fix in waves, not as we go.** Finish the findings first, then fix them in priority order. Fixing mid-audit hides what was found and muddles before/after numbers. The one exception is a Critical that's live in a deployed environment: stop and fix it.
- **Building carries on during the audit.** Development continues on `main` (in other Claude Code sessions) while the audit runs. The audit never blocks or switches that work:
  - **Separate checkout.** The audit runs in its own git worktree (`git worktree add "../granite-sms-audit" audit-2-baseline`), never in the folder where building happens. Switching branches in a shared folder moves other sessions' commits onto the wrong branch. That happened once while this plan was being written; it was caught and fixed.
  - **Each finding records its commit.** Note the hash of the commit it was found on.
  - **Re-check before reporting.** At the end of each phase, move the audit worktree to the latest `main` and re-check that phase's findings. Drop those already fixed by new work. Scan the new commits since the last checkpoint (`git log <last-checkpoint>..main`) for the same classes of problem.
  - **New code gets the permanent checks.** The checks that become permanent (role matrix, ledger invariants, server lint) go into CI early, so new code pushed to `main` is covered as soon as it lands, not just the snapshot.
  - **Fixes land in small pieces.** Each fix goes on its own short-lived branch, merged quickly, so it doesn't collide with ongoing feature work.

---

## 1. Before the audit starts

| # | Task | Why |
|---|---|---|
| 1.1 | Tag the current `main` commit as `audit-2-baseline` (whatever is pushed at the time; work in progress stays where it is). Create the audit worktree from that tag, in its own folder. | An audit has to be of a fixed commit, or findings can't be reproduced. A separate worktree keeps the audit from disturbing the sessions building on `main`. |
| 1.2 | Start a throwaway Postgres 16 (as in Audit 1: port 55432, `127.0.0.1`, not `localhost`). Run `migrate deploy`, then the demo seed. | A clean, known starting point. |
| 1.3 | Record the baseline: test count and pass rate (currently 34 files and about 173 tests), `npm audit --omit=dev` for both apps, lint output, production build size per chunk, and p50/p95 for the 25 busiest endpoints. | Every "improved" claim in the report needs a before number. |
| 1.4 | Add `vitest --coverage` (v8) to the server and record line and branch coverage per module. | Shows which money and marks code has no tests. |
| 1.5 | Write down what's deployed where: Render API, Neon databases (prod, demo, any branches), Cloudflare demo client, GitHub Actions secrets. Note each one's env vars (names only, no values). | Several checks depend on knowing which environment does what. |

---

## 2. Phase 1: Regression of Audit 1 (`REG`)

Re-run each original attack against the baseline. Each one passes only if the attack now fails in the expected way. Anything that still works is automatically a Critical or High in Audit 2.

### 2.1 Re-run the verified attacks

| Audit 1 ID | Re-test | Expected now |
|---|---|---|
| C1 | 5, 20 and 50 parallel payments against one invoice, plus parallel reversals, plus an M-Pesa confirmation racing a cash payment | Exactly the right number accepted. `paid` equals the sum of allocations. `npm run fees:reconcile` is clean. |
| C2 | Try REPLACE restore through the UI and the API. Run `backup-db.yml` on a schedule and restore a dump into a scratch DB. | REPLACE is refused. The dump restores and row counts match. |
| C3 | `npm run db:drift` on the baseline. Read-only `migrate diff` against prod Neon (you run it). | No drift. |
| C4 | Admin edits, resets, suspends or demotes another admin, or changes their email | 403 |
| H1 | A flagged user calls 10 random endpoints, including `/api/users`, `/api/schools` and the fees PDF routes (those have their own middleware) | 403 `PASSWORD_CHANGE_REQUIRED` everywhere except the two allowed routes |
| H2 | Change password, then reuse the old token on every router (`/api/users`, `/api/schools`, tenant routes, `change-password`). Impersonate and check the audit row. | 401 `AUTH_SESSION_REVOKED`. The impersonation is logged with the real actor. |
| H3/H4 | 40 staff logging in from one IP. Lock an account, wait for expiry, then one bad try. Compare responses for locked and unknown emails. | No school-wide lockout, no instant re-lock, identical responses |
| H5 | Bursar reverses a payment | Becomes a request, and only an admin approves it |
| H6 | Teacher dashboard | No fees block |
| H7 | Invoice from a mismatched or inactive plan, single and bulk | Refused |
| H9 | Publish, then change a mark, move a student or add a student | Printed results don't change. Unpublish requires a reason and is logged. |
| H10, M9 | Time the list endpoints on the scaled seed. Confirm GETs don't write (watch Prisma query logs). | Stays inside the budget in 4.2. Zero writes on reads. |
| M1 | Fuzz every route's query and body with wrong types, bad enums, huge strings and arrays where a string is expected (Express 5 parses `?a=1&a=2` as an array) | 4xx, never a 500 |
| M3/M4 | A payment at 00:30 EAT. Change the term dates and check every screen's default term. | Counted on the right day. Defaults follow the current term. |
| M14 | Send a spoofed `X-Forwarded-For` | The audit log shows the real IP |
| 15 cross-school probes | Repeat all 15, plus the new modules: guardians, notices, SMS, M-Pesa, portal, import, export, report cards, grade scales, term dates | All refused |

### 2.2 Items Audit 1 left open

- The platform-owner password that was seeded into the live Render DB has been changed (you confirm).
- The Prisma 7 migration and the `exceljs` advisory are still deferred. Re-assess whether `exceljs` is reachable through student import.
- Sentry was never added (needed a DSN). This moves to `OPS`.
- Feature 11 (timetable, discipline, library, transport, HR) is still open. It's out of scope for an audit and listed only for the roadmap.

### 2.3 Scaled test data

Extend `seedDemo.js` with a `SCALE` option so it can generate:

- **Small school:** 300 students
- **Large school:** 1,500 students, 3 years of fees, exams and attendance
- **Very large school:** 4,000 students
- **Platform:** 200 schools, so the platform admin screens and cross-tenant queries face realistic volume

Phases 4 and 5 use this.

---

## 3. Phase 2: Security (`SEC`)

### 3.1 Sign-in and sessions

- **Token storage.** The JWT sits in `localStorage` ([axios.js](../client/src/api/axios.js)), so any XSS on the client domain means account takeover. Decide between an httpOnly `SameSite=Strict` cookie (needs CSRF handling) and keeping the bearer token behind a strict CSP (3.8). Write up the trade-off and pick one.
- **Fallback header.** `x-access-token` is accepted alongside `Authorization` ([auth.js](../server/src/middleware/auth.js)). Remove it unless something needs it, since it's more surface for no benefit.
- **Token lifetime and refresh.** Tokens last 12 hours. Check what happens at expiry mid-task (marks entry, cashier). Does the user lose the form? Decide whether silent refresh is needed.
- **All three auth paths.** There are three: tenant routes (`tenantContext`), `/api/schools` (`requireFreshSystemAdmin`) and `/api/users` (its own middleware). Confirm each one calls `sessionProblem` with the same options. Add a test that fails if a new router skips it.
- **Impersonation.** Check that it's time-limited, that a banner shows on screen, that it's logged with the real actor on every action, that it can't reach another SYSTEM_ADMIN, and that it can't change the target's password or email.
- **Bootstrap signup.** It counts users and then creates one, so two parallel calls with `ALLOW_BOOTSTRAP=true` could create two SYSTEM_ADMINs. Confirm `ALLOW_BOOTSTRAP` is off everywhere deployed. Make the check atomic or remove the route once bootstrapped.
- **Stub route.** `/api/auth/admin/create-user` exists as a stub. Remove it.
- **Passwords.** The policy is 8 or more characters with letters and numbers. Check it against a common-password list. Review the bcrypt cost (10 today; 12 is the usual floor now). Find out whether there's any self-service "forgot password" for parents and staff, or whether every reset lands on the school admin. That's a support-load question as well as a security one.
- **Two-factor sign-in.** Assess TOTP for SYSTEM_ADMIN (required), ADMIN and BURSAR (optional). These accounts move money and can impersonate.
- **Parent and student sign-in.** Check the identifier (email or phone), how first passwords are delivered (SMS?), and what stops one parent guessing another's account.

### 3.2 Authorization (who can do what)

- **Route × role matrix.** Write a script that walks the Express router stack (163 routes) and lists each route's method, path, `requireRole`, `requireFeature` and `requireTenant`. Turn it into a generated test that calls every route as every role (SYSTEM_ADMIN with and without a school, ADMIN, BURSAR, TEACHER, STUDENT, PARENT, signed out) and checks the status against an expected-matrix file. A new route without an entry fails CI. This is the most valuable security test the project can have.
- **Object-level checks.** For every `findUnique` or `findFirst` by `id`, confirm the record's `schoolId` (and, for teachers, students and parents, their scope) is checked before use. Grep for `where: { id` with no `schoolId`, and probe each hit.
- **Mass assignment.** Grep for `...req.body` or `data: req.body` going into Prisma `create` or `update`. A user should never be able to set `schoolId`, `role`, `paid`, `balance`, `isActive` or `tokenVersion` through a body.
- **Scope helpers.** There are three overlapping ones: `teacherScope.js`, `learnerAccess.js` and `roleScope.js`. Map which module uses which, find disagreements (Audit 1 M7 was exactly this), and consolidate to one.
- **Parents with several children.** A parent should see exactly their linked children, should lose access when unlinked, and should get nothing for a sibling at another school.
- **Plan gating.** Confirm `requireFeature` blocks on the server, not just the menus, for an expired trial, a suspended school and a plan without a module.

### 3.3 Tenant isolation design

- Isolation today is a `schoolId` filter written by hand in each query. It holds (15 of 15 probes in Audit 1), but every new query is a fresh chance to leak. Assess two layers of defense in depth:
  1. A Prisma client extension that injects and checks `schoolId` on tenant models.
  2. Postgres row-level security keyed on a per-request `app.school_id` setting.
  Recommend one, with its cost.
- **School lookup.** `resolveSchoolByIdOrCodeCached` matches `id OR code`. Test a school whose `code` equals another school's `id`. Make sure ids and codes can't collide, or look up by id only.
- **Caches.** The `SCHOOL_CACHE` and `USER_CACHE` keys: confirm a suspended school is blocked on the next request (`invalidateSchoolCache` gets called on every path that changes a school).

### 3.4 Input validation

- There's no schema library on the server. Validation is hand-written helpers ([validate.js](../server/src/utils/validate.js)) plus per-route checks. Assess moving to zod (already a client dependency) with shared request schemas in one place, so the client form and the server check can't drift.
- **Money inputs.** Negative amounts, decimals (money columns are `Int`, so is that whole shillings?), `1e9`, strings, zero, amounts above the balance and extra charges.
- **Dates and text.** Date ranges (birth dates, term dates that overlap, end before start), maximum lengths on all text, and Unicode in names (Kenyan names with apostrophes; PDF rendering of non-Latin text).

### 3.5 Files: uploads, imports, exports, PDFs

- **Student import (XLSX/CSV).** File size limit, row limit, zip-bomb XLSX, formulas inside cells, and a double submit of the same file.
- **Formula injection in exports.** Any exported cell that starts with `=`, `+`, `-` or `@` (a student named `=HYPERLINK(...)`) must be escaped in CSV and XLSX. Check `utils/export.js` and `csv-stringify` usage.
- **PDFs.** PDFkit handles user-controlled text (school name, comments, report design). Test very long values and many lines for layout breaks and memory/time DoS. Time class-wide report-card PDFs for a 60-student class.
- **Logos.** Magic-byte check (L7), size limit, SVG handling (SVG can carry script), and the public logo route not leaking anything beyond the image.

### 3.6 Public endpoints

- **M-Pesa callbacks** (`/api/public/mpesa/:token/...`):
  - The secret token is in the URL path, and the production request log writes `path` on every line ([app.js](../server/src/app.js), request log). **SUSPECTED:** the callback token is in production logs. Verify, then redact it in the logger.
  - Check: Safaricom source-IP allowlist, duplicate callback handling (same `TransID` twice), amount and paybill validation, a callback for a school whose config was deleted, and that `c2b/validation` can't be used to probe admission numbers.
- **STK push** is abusable for harassment and cost: any bursar can push to any phone number. Check rate limits per school and per phone, and that the number belongs to a linked guardian.
- **Demo login.** Confirm it only exists when `DEMO_MODE` is on and the demo DB guard holds.

### 3.7 Secrets and config

- **Git history.** Run `gitleaks` over the full history, not only the current tree. `.env` files are ignored now; check they never were tracked.
- **`secretBox.js`.** Review how M-Pesa credentials are encrypted: cipher and mode, a unique IV per value, auth tag checked, key length, and how the key could be rotated.
- **Env validation at boot.** Only `JWT_SECRET` is checked today. Validate every required var at boot with a schema and fail fast. Add `server/.env.example` and `client/.env.example` that list every variable.
- **GitHub Actions.** `backup-db.yml` and `refresh-demo.yml`: secrets scoped to the right environment, actions pinned (ideally by SHA), and `permissions:` set to the minimum.

### 3.8 HTTP and browser hardening

- **Client CSP.** The client on Cloudflare has only `_redirects`, with no `_headers` file. Add one with a strict CSP, `frame-ancestors 'none'` (stops clickjacking on the cashier and payment screens), HSTS, `Referrer-Policy` and `Permissions-Policy`. Because the token lives in `localStorage`, this is the main defense.
- **CORS.** `credentials: true` is set but no cookies are used. Remove it, or keep it deliberately if you move to cookies.
- **`trust proxy`.** It's set to `1`. If Cloudflare sits in front of Render that's two hops, and every user would share one IP for rate limits and audit logs. Check the real topology and set it to match.
- **ETags.** `app.disable("etag")` is global. Find out why, and whether static-ish responses (settings, logos, `/api/me`) lose caching because of it.

### 3.9 Abuse and cost controls

- **Rate limits** use the in-memory store, so they count separately per instance (see 6.4).
- **SMS spend.** Bulk SMS (fee reminders to a whole school) needs a per-school daily cap, a confirm step showing the count and estimated cost, and a block on repeat sends. One mistake there costs real money.
- **Heavy endpoints** (PDF, XLSX export, reports, bulk invoice generation, promotion) need per-user concurrency limits so one user can't stall the server.

### 3.10 Dependencies and supply chain

- `npm audit` for both apps. Turn on Dependabot or Renovate. Pin GitHub Actions versions.
- **Prisma version.** The Dockerfile installs `prisma@6.19.3` on its own while `package.json` says `^6.19.1`. Make the CLI and client versions come from one place.
- **Static analysis.** Run Semgrep with the express, react, jwt and secrets rulesets. Triage the results; don't paste them into the report raw.

### 3.11 The audit log

- **Coverage.** Check that every money change, mark change after submit, role or user change, export, impersonation, restore, setting change and consent change writes an audit row with actor, school, target, before/after and real IP.
- **Tamper-proofing.** Can anyone delete or edit audit rows, through the API or the restore flow? An admin covering up a reversal is the threat here.
- **Retention.** Is there a rule, and does it agree with docs/PRIVACY.md?

---

## 4. Phase 3: Data integrity and business logic (`DATA`)

### 4.1 Money

- **List every write path** that changes `FeeInvoice.paid` or `balance`, `FeePayment` or `FeePaymentAllocation`: cash payment, M-Pesa auto-match, M-Pesa manual assign, STK confirm, reversal approve, credit allocation, extra charge, discount, promotion carry-forward, bulk generate. Each must run in one transaction with the row locked.
- **Invariants.** Write these as a SQL check and as a test that runs after the whole suite:
  - `invoice.paid = sum(allocations to it)`
  - `invoice.balance = total - paid`
  - `payment.amount = sum(its allocations) + unallocated credit`
  - No negative balance unless the ledger shows a credit
  - Receipt numbers per school and year have no gaps and no duplicates
  - Run `fees:reconcile` in CI against the seeded DB after the tests.
- **Property-based tests** (fast-check) on `modules/fees/ledger.js`: random sequences of charges, payments, reversals and allocations always keep the invariants.
- **Rounding.** Discounts given as a percentage: how is the result rounded, and does it match what the bursar's own calculation would give?

### 4.2 Academic results

- **Grade bands.** Boundaries (is 49.5 a pass?), gaps or overlaps in a school's custom scale, and a scale changed after marks are entered.
- **Ranking.** Ties (1, 2, 2, 4), absent versus zero, a student with missing subjects, and position "out of N" when students join or leave.
- **Weighting.** Weights that don't add up to 100, per-marksheet `outOf`, a CAT left out, and how CBC rubric levels and KCSE points mix in one school (primary and secondary together).
- **Frozen results.** Confirm a published result can't change through any path: a mark edit, a scale edit, a student edit, promotion or restore.
- **Promotion.** Repeaters, leavers, the final class becoming alumni, running promotion twice, and promotion in the middle of an open exam.

### 4.3 Attendance

- Two registers for one class on one day, a student joining mid-term (should days before joining count as absent?), edits after submit and their log, registers on holidays, and percentages for students who left.

### 4.4 State machines

Draw each one, then check with the API that no illegal transition is reachable:

- **Student:** active → left → anonymised (anonymising can't be undone, and nothing still points at the old identity)
- **Exam session:** draft → open → locked → published → unpublished → republished
- **Invoice:** issued → part-paid → paid → reversed or credited
- **Reversal request:** requested → approved or rejected (can't approve twice, can't approve your own)
- **Subscription:** TRIAL → ACTIVE → expired or suspended. What can the school still do, and can they still get their data out?
- **SMS message:** queued → sent or failed → retried

### 4.5 Database design

- **Indexes.** Every query filtered by school should have an index starting with `schoolId`. List the hot queries and check each with `EXPLAIN ANALYZE` on the scaled seed.
- **Uniqueness.** Every unique constraint on tenant data should include `schoolId` (admission number, receipt number, class name, subject code).
- **Columns.** Review `onDelete` rules, nullable columns that shouldn't be, and JSON columns (`entitlements` and others): who validates their shape?
- **Size.** Logos are stored as bytes in the main database (`SchoolLogo`), and snapshots sit in the `Backup` table, so a database backup also contains backups. Project the size at 200 schools.
- **Migrations.** There are 44 so far. Write down rules for future ones (add column → backfill → enforce, never rename in place) so deploys don't take the site down.

### 4.6 Races beyond payments

- Two teachers saving the same marksheet, a double-clicked bulk invoice generation, import submitted twice, promotion triggered twice, `DocumentCounter` under load, and an M-Pesa callback arriving at the same moment a bursar manually assigns the same transaction.
- **SMS outbox (SUSPECTED double send).** `flushOutbox` ([sms.js](../server/src/modules/sms/sms.js)) reads queued rows with `findMany` and sends them without claiming them first. The in-process `flushing` guard only works inside one process. With two instances, or a send-at-once racing the 60-second flush, the same message can go out twice. Verify, then claim rows atomically (`UPDATE ... SET status='SENDING' ... RETURNING`, or `FOR UPDATE SKIP LOCKED`).

### 4.7 Dates and time zones

- Grep both apps for `new Date()`, `toISOString().slice(0, 10)`, `getDay()` and `setHours(0`. Each one must go through `schoolTime.js` (server) or `schoolCalendar.js` (client).

---

## 5. Phase 4: Performance and scale (`PERF`)

### 5.1 Budgets

These are the pass marks, measured on the large-school seed (1,500 students) with server time and a cold cache.

| Kind | p95 |
|---|---|
| List or search endpoint | under 300 ms |
| Dashboard | under 500 ms |
| Single PDF (receipt, slip) | under 800 ms |
| Class report-card PDF (60 students) | under 8 s, or moved to a background job |
| Full school XLSX export | under 20 s, or moved to a background job |
| First load on 3G with a mid-range Android | interactive under 5 s |

### 5.2 Server

- **Queries per request.** Add a dev-only middleware that counts Prisma queries per request and logs any request over 15. Start with the results calculation, `dashboard.service.js` (546 lines) and the reports services.
- **Unbounded lists.** There are 114 `findMany` calls. List the ones without `take` that can grow with school size.
- **Database stats.** Turn on `pg_stat_statements` on the test DB, run the E2E journeys (7.6), and review the top 20 queries by total time.
- **Load test.** Use k6 or autocannon to model Monday morning: 40 teachers taking registers at once, a bursar on fee day handling 200 payments an hour with M-Pesa callbacks landing, and results day with 500 parents opening slips.
- **Connections.** Check the Neon pooler with Prisma's `connection_limit`, Render instance memory under PDF load, and cold-start time.

### 5.3 Client

- **Bundles.** Run `rollup-plugin-visualizer` and check that heavy libraries only load on the pages that need them.
- **Lighthouse.** Run it on login, dashboard, cashier, marks entry and the parent portal, throttled to mobile.
- **Big grids.** Marks entry for 60 students × 10 subjects, and the student list. Count re-renders per keystroke, and decide whether virtualization is needed.
- **React Query.** Check `staleTime` and `gcTime` defaults, refetch-on-focus storms, and that every mutation invalidates the right keys and no more.
- **Static assets.** `og.png` and the manifest icons are large; check and compress them. Check fonts and caching headers on Cloudflare.

---

## 6. Phase 5: Reliability and operations (`OPS`)

### 6.1 Backups and recovery

- Set targets: how much data you can afford to lose (RPO) and how long recovery may take (RTO). A school can't lose a fee day, so an RPO under 24 hours is the floor, and Neon point-in-time restore should cover much better.
- Run a full restore drill from the off-site dump. Time it and write the steps into docs/BACKUPS.md.
- Restore one school without touching the others. Is that possible today? If not, write down what it would take.

### 6.2 Monitoring

- **Errors.** Add Sentry (or similar) on both apps, with PII scrubbing.
- **Logs.** There are 108 `console.*` calls on the server. Move to one logger (pino) with request ids and a redaction list: tokens, passwords, phone numbers, the M-Pesa path token.
- **Alerts.** 5xx rate, `/health/ready` failing, SMS failure rate, unmatched M-Pesa transactions older than a day, reconcile mismatches, and backup job failures.
- **Uptime.** An external uptime check on the API and the client.

### 6.3 Background work

- The SMS outbox runs on `setInterval` inside the web process ([index.js](../server/index.js)). The retention, reconcile and results-freeze scripts exist, but who runs them, and when? Choose one job runner (a Render cron job, or a worker using pg-boss or graphile-worker on the same Postgres). Each job takes a lock, records its runs, and alerts on failure.

### 6.4 Running more than one instance

List everything that breaks or misbehaves with two API instances. Known so far:

- `USER_CACHE` and `SCHOOL_CACHE` are in memory, so invalidation only reaches the local instance.
- The rate limiter's memory store counts per instance.
- The SMS `setInterval` and its `flushing` guard (see 4.6).
- `prisma migrate deploy` runs on every container start.

For each, decide: fix now, or "run a single instance until X" (written down, with the trigger to revisit).

### 6.5 Failure modes

- Simulate each and check that the UI shows something sensible: database down, database slow (5 s), Africa's Talking down, Daraja down or slow, a PDF timing out, a deploy mid-payment (does the graceful shutdown hold?).
- Every outbound HTTP call (SMS, Daraja) must have a timeout and bounded retries.

### 6.6 Environments and deploys

- Separate dev, staging, production and demo. Staging should get its own Neon branch.
- Write a release checklist: migrations, env vars, smoke test, and how to roll back, including a migration that can't be reversed.
- Pushing straight to `main` is fine while you're the only developer and nothing is live. Once the first school is on it, deploy from a tag or release branch rather than every push to `main`, so a half-finished feature can't reach a school. Turn on "CI must pass" for whatever branch deploys.

---

## 7. Phase 6: User experience (`UX`) and accessibility (`A11Y`)

Audit 1's screen pass covered layout and console errors at 1366px and 390px. This phase is about whether people can get their work done.

### 7.1 Timed task walkthroughs

For each task: time it, count the clicks, and note every hesitation, dead end, unclear label and missing confirmation. Run each on desktop and on a 360px Android (the most common Kenyan phone width, narrower than the 390px already checked).

| Role | Tasks |
|---|---|
| SYSTEM_ADMIN | Create a school, set its plan, create its first admin, impersonate for support, suspend it |
| ADMIN (new school) | First sign-in to a ready-to-use school: term dates, classes, subjects, teachers, import 300 students, fee plans, first invoices |
| ADMIN (daily) | Approve a reversal, publish results, send a notice, find who changed a mark |
| BURSAR | Take a cash payment and print the receipt, match an unmatched M-Pesa payment, end-of-day cash-up, a parent's statement, chase defaulters by SMS |
| TEACHER | Take a register (40 students), enter marks for one subject from a paper list, fix a wrong mark, see "my classes" |
| PARENT | See balance and pay (STK), see the latest results, download a report card, read notices, switch between children |
| STUDENT | See own results and attendance |

### 7.2 First run and empty states

- A new school today lands on empty screens. Assess a setup checklist (term dates → classes → subjects → staff → students → fee plans), with each empty state linking to the next step.
- Every list needs a useful empty state that says what to do next, not just "No data".

### 7.3 Forms and data entry

- **Marks entry.** This is where teachers spend the most time. Check keyboard flow (Enter and arrows move cells), pasting a column from Excel, out-of-range values flagged inline, autosave or a clear unsaved-changes warning, and what happens when the session expires mid-entry.
- **All forms.** Double-submit protection, server errors mapped to the right field (`lib/errors.js`), required fields marked, and sensible defaults (current term, today in school time).
- **Destructive actions.** Every one needs a confirm that names the thing ("Reverse KES 12,000 receipt R-2026-0412 for Achieng?"), not a generic "Are you sure?".

### 7.4 Lists and navigation

- Filters, search, page and sort kept in the URL, so the back button and shared links work.
- One pager and one filter-bar pattern everywhere (`pager.jsx`, `ReportKit.jsx`).
- Check whether QuickSearch finds students by name, admission number and guardian phone.
- Breadcrumbs and page titles: the browser tab says where you are.

### 7.5 Feedback and poor connections

- Behaviour on slow or flaky mobile data: retry, an "offline" banner, and no lost input.
- Long operations (bulk invoices, promotion, imports, class PDFs) show progress and survive navigating away.
- Toasts versus inline messages: one rule applied everywhere.

### 7.6 Printing

- **Thermal receipts.** Receipts on 58mm and 80mm thermal printers, which many bursaries use, as well as A4 and A5.
- **Report cards and slips.** Long names, many subjects, a school with no logo, a school with a large logo, black-and-white printing.
- **Two print paths.** Browser print and server PDF both exist, with duplicated pieces (`components/print/PrintLetterhead.jsx` and `features/fees/print/PrintLetterhead.jsx`). Decide which documents use which, and remove the duplicates.

### 7.7 Accessibility (WCAG 2.2 AA)

- Run axe-core through Playwright on every screen for every role. Fix all serious and critical issues.
- **Keyboard only:** every journey in 7.1 completed without a mouse, with focus visible and focus returned after dialogs and sheets close.
- **Brand colours.** Schools pick their own colours. Check text contrast on those colours, and clamp or auto-pick the text colour when a school's choice fails AA.
- Form labels, error messages announced to screen readers, tables with headers, icon-only buttons with labels. There are only 87 `aria-` attributes across 187 files; check whether that's enough.

### 7.8 Copy and formatting

- **Amounts:** KES everywhere, with thousands separators.
- **Dates:** `dd/mm/yyyy` or `13 Nov 2026`, never US order.
- **Language:** plain, consistent terms (one word each for "learner"/"student" and "parent"/"guardian").
- **Kiswahili:** assess whether the parent portal and SMS templates should offer it.

---

## 8. Phase 7: Maintainability (`CODE`)

The aim is that a change to one feature touches one place, and a new developer (or you in six months) can find it.

### 8.1 Server structure

- **Two styles side by side.** `routes/*.js` files hold the logic inside the route handlers (`auth.js` 612 lines, `users.js` 605, `students.js` 577), while `modules/*` split it into routes, controller and service. Pick `modules/`, write down the layout in one page, and move route files over as they're touched. Logic inside route handlers can't be unit-tested.
- **Error boilerplate.** Around 160 handlers repeat `try { … } catch { console.error; res.status(500) }`. Express 5 passes async errors to the error handler on its own. Introduce an `AppError(status, code, message)` and remove the repeated blocks.
- **Response shapes.** Lists return `{ schools }` in one place and `{ items, total }` in another. Pick one list shape and one error shape (`{ message, code }`) and use them everywhere.
- **Linting.** The server has no lint script and CI only lints the client. Add ESLint to the server.

### 8.2 Client structure

- **Two API layers.** There's `src/api/*.api.js` and also `features/*/x.api.js`. Choose one location.
- **Data fetching.** 71 files use React Query, but 31 feature or page files call `api` directly. Find the direct calls that skip caching and invalidation.
- **Large components.** `FeeCashierTab.jsx` (933 lines), `SubscriptionLimitsTab.jsx` (892), `StudentsListPage.jsx` (652), and 15 more over 400. Split each into data hooks and presentational parts.
- **Duplicate helpers.** Two `format.js` files (reports, results) and two letterheads. Fold each pair into one.
- **Leftovers.** `assets/react.svg`, `App.css`, `pages/Placeholder.jsx`. Check whether they're used.

### 8.3 Types and contracts

- Both apps are plain JavaScript. Choose one:
  - **Cheapest:** `// @ts-check`, JSDoc and `checkJs` on the money and results code.
  - **Middle:** shared zod schemas for requests and responses, with types inferred from them.
  - **Most:** a gradual move to TypeScript.

  The recommendation will be made after measuring how often bugs in git history were type bugs.

### 8.4 Tests

- **Current state.** There are about 173 server integration tests (good), no client tests and no end-to-end tests.
- **Add these:**
  - The generated route × role matrix test (3.2)
  - The ledger property tests and the invariants check (4.1)
  - Playwright E2E for the 10 most important journeys in 7.1, run in CI against the seeded DB, with axe checks included
  - A small set of client unit tests for pure logic (money formatting, grade display, date helpers)
- **Coverage gate.** Use the baseline from 1.4, then require that coverage of `modules/fees` and `modules/exams` doesn't drop.

### 8.5 Repo hygiene

- **Root README.** There's none. Write one covering what it is, the architecture (one diagram), local setup in five commands, the env var table, how to add a module, and how to run the tests.
- **Line endings.** Add `.gitattributes`; git currently warns about LF/CRLF on 8 files.
- **Comments.** A lot of them tell the history ("Previously this...", "✅ ..."). That belongs in commits. Keep comments that explain *why*.
- **Docs.** `AUDIT_REPORT.md` sits at the root while the other docs are in `docs/`. Move it, and write short decision records for the big choices (auth storage, tenancy enforcement, job runner).

---

## 9. Phase 8: SaaS product and compliance (`SAAS`)

### 9.1 School lifecycle

- **Onboarding.** Schools are created by the platform admin only. Is that the intended model for launch? Write down the onboarding steps and how long they take.
- **Trial end.** What exactly happens when a trial ends: read-only, or locked? Can the school still export its data? The current menus hide modules when expired. Check that the API also allows a data export.
- **Leaving.** Suspension, cancellation, full data export on exit, and deletion after a stated period.

### 9.2 Billing and plans

- **Collecting payment.** Plans, limits and entitlements exist, but how does GlimmerInk actually bill schools (manual invoice, M-Pesa, card)? Check how a subscription becomes ACTIVE and what the audit trail is.
- **Limit enforcement.** Hitting a limit (students, teachers, classes, users) should give the same response and the same message everywhere. Audit 1's L1 merged this; check that it held.

### 9.3 Platform admin

- A platform view of active schools, users active this month, error rates per school, and SMS spend per school.
- Support access with an audit trail that the school can see.

### 9.4 Privacy (Kenya Data Protection Act, 2019)

- **Implementation.** Check docs/PRIVACY.md against the code: consent capture, the retention job actually scheduled, per-student data export, and that anonymising is complete. That includes SMS logs, M-Pesa transactions (names and phone numbers), audit log metadata, guardians and backups.
- **Sub-processors.** List them with their regions: Neon, Render, Cloudflare, Africa's Talking, Safaricom, GitHub (backup artifacts?). Note where student data physically lives.
- **Breach runbook.** Who to notify, within 72 hours, and with what information. Fill it from the logging in 6.2.
- **Templates for schools.** A data-processing agreement, a privacy notice and a consent form.

---

## 10. Tools

| Need | Tool |
|---|---|
| Throwaway DB | Docker Postgres 16 on port 55432 |
| API attacks and the role matrix | Vitest + Supertest (existing harness), plus the router-walk script |
| Browser journeys, screenshots and accessibility | Playwright + `@axe-core/playwright` |
| Load | k6 or autocannon |
| Query profiling | Prisma query events, `pg_stat_statements`, `EXPLAIN ANALYZE` |
| Static analysis | Semgrep, ESLint (server and client), `npm audit` |
| Secrets | gitleaks (full history) |
| Money logic | fast-check property tests |
| Bundle size | `rollup-plugin-visualizer`, Lighthouse CI |
| Coverage | `@vitest/coverage-v8` |

---

## 11. Order and time

Security and data come first because they're the hardest to fix after schools have real data. Maintainability comes last because refactoring first would move the code findings point to.

| Phase | Work | Estimate |
|---|---|---|
| 0 | Baseline (section 1) | 0.5 day |
| 1 | Audit 1 regression and scaled seed (section 2) | 1.5 days |
| 2 | Security (section 3) | 4 days |
| 3 | Data and logic (section 4) | 3 days |
| 4 | Performance (section 5) | 2 days |
| 5 | Reliability and ops (section 6) | 1.5 days |
| 6 | UX and accessibility (section 7) | 3 days |
| 7 | Maintainability (section 8) | 1.5 days |
| 8 | SaaS and compliance (section 9) | 1 day |
| — | Write `AUDIT_REPORT_2.md`, rank findings, plan fix waves | 1 day |
| | **Total** | **about 19 working days** |

Phases 2 and 3 share the attack harness, so run them together. Phase 6 can run alongside phases 4 and 5 because it only needs the seeded demo.

---

## 12. Deliverables

1. **`docs/AUDIT_REPORT_2.md`**, in the same format as Audit 1: summary table, what's solid (verified), then the findings by severity.
2. **Before/after numbers:** tests, coverage, vulnerabilities, p95 per endpoint, bundle size, axe violations, task times per role.
3. **New permanent checks in CI:** the role matrix, ledger invariants and reconcile, E2E journeys with axe, server lint, gitleaks and the coverage gate.
4. **Fix waves:**
   - **Wave A:** the launch gate below
   - **Wave B:** product-ready
   - **Wave C:** maintainability and polish
5. **Short docs:** root README, env var table, release checklist, restore runbook, breach runbook, and the decision records.

---

## 13. Launch gate: before the first paying school

Every item below has to be true, with evidence in the report:

- [ ] No open Critical or High findings.
- [ ] The role × route matrix test passes and runs in CI.
- [ ] The ledger invariants and reconcile are clean after the full test suite and after the load test.
- [ ] A restore drill from the off-site backup is done and timed, and the steps are written down.
- [ ] Error tracking and alerting are live. A test error reaches you within 5 minutes.
- [ ] The client is served with a strict CSP and `frame-ancestors 'none'`.
- [ ] No secrets in logs (the M-Pesa token, auth tokens and passwords are redacted) and none in git history.
- [ ] SMS sending can't send twice and has a per-school daily cap.
- [ ] Background jobs (SMS, retention, reconcile) run on a schedule with a lock and an alert on failure.
- [ ] Every journey in 7.1 is completed on a 360px phone with no blocker, and axe reports no serious or critical issues.
- [ ] The data-processing agreement, privacy notice and consent form templates are ready for the school.
- [ ] Single instance or multiple: decided, and every item in 6.4 is handled for that decision.

---

## Appendix: Leads noticed while writing this plan

These came up while reading the code for this plan. None has been confirmed yet. They're starting points for the phases above, not findings.

| Lead | Where | Phase |
|---|---|---|
| The M-Pesa callback token is in the URL path, and the production request log writes the path | `routes/mpesa.js` public router; `app.js` request log | 3.6 |
| The SMS outbox reads queued rows and sends them without claiming them first, so a second instance or the 60 s timer can send a message twice | `modules/sms/sms.js` `flushOutbox`; `index.js` | 4.6 |
| The JWT is in `localStorage` and the client has no CSP (`public/` has `_redirects` but no `_headers`) | `client/src/api/axios.js`, `client/public/` | 3.1, 3.8 |
| School lookup matches `id OR code`, so a code equal to another school's id is ambiguous | `middleware/tenant.js` | 3.3 |
| User and school caches and the rate limiter are in memory: single-instance only | `middleware/tenant.js`, `middleware/rateLimits.js` | 6.4 |
| An `x-access-token` header is accepted as a fallback for the bearer token | `middleware/auth.js` | 3.1 |
| CORS has `credentials: true` but there are no cookies | `app.js` | 3.8 |
| `trust proxy` is `1`; this may be wrong if Cloudflare sits in front of Render | `app.js` | 3.8 |
| Bootstrap signup counts users and then creates one, with no lock | `routes/auth.js` `/signup` | 3.1 |
| The `/api/auth/admin/create-user` stub route is still mounted | `routes/auth.js` | 3.1 |
| bcrypt cost is 10 | `routes/auth.js` | 3.1 |
| ETags are turned off for the whole app | `app.js` | 3.8, 5.3 |
| No server schema validation library; checks are hand-written per route | `utils/validate.js` | 3.4 |
| Three overlapping access-scope helpers | `utils/teacherScope.js`, `learnerAccess.js`, `roleScope.js` | 3.2 |
| The Dockerfile installs `prisma@6.19.3` separately from the `package.json` range | `server/Dockerfile` | 3.10 |
| No server lint, no client tests, no E2E tests in CI | `.github/workflows/ci.yml` | 8.4 |
| Two route styles (fat route files and modules), and two client API layers | `server/src/routes` vs `modules`; `client/src/api` vs `features/*/x.api.js` | 8.1, 8.2 |
| Duplicate print letterheads and format helpers | `components/print`, `features/fees/print`; `reports/utils`, `results/utils` | 7.6, 8.2 |
| No root README; no `.gitattributes` (LF/CRLF warnings) | repo root | 8.5 |
| Every push to `main` may deploy; fine before launch, risky after | deploy setup | 6.6 |
