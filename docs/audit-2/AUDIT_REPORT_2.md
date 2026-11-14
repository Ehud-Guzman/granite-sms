# Granite SMS: Audit 2 report

**Dates:** 13–14 Nov 2026 · **Commit audited:** `audit-2-baseline` (`05ddd5e`) · **Branch:** `audit-2` · **Plan:** [../AUDIT_PLAN.md](../AUDIT_PLAN.md)

Details: [BASELINE.md](BASELINE.md) (Phase 0), [PHASE1.md](PHASE1.md) (regression and scale), [PHASE2.md](PHASE2.md) (security). Phases 3–8 are below. Because the session was ending, they were done as **targeted code checks**, not the full browser walkthroughs, load tests and drills in the plan. Section 4 lists what that leaves undone.

## 1. Bottom line

- **Audit 1's 42 fixes hold.** They were re-checked with every-route sweeps across 171 routes: no cross-school leak or change, no bad session accepted, no 500 on junk input, and no read that writes data.
- **No Critical issues.** There was **one High**, forgeable M-Pesa payments, and it's **fixed** in commit `19f5ee0` on `audit-2`.
- **What's open:** 6 Medium security and ops findings, 2 Medium UX/accessibility findings, and a set of Lows. The speed findings (A2-PERF-01/02/03) are fixed; see section 2a.
- **Tests:** 187 server tests pass (183 before Audit 2, plus 4 new M-Pesa tests). 8 more, gated behind `AUDIT2_SWEEP=1`, state the safe behaviour for open findings and fail until each is fixed.

## 2. Findings, in fix order

**Update, 14 Nov:** seven of the Mediums are now fixed on `main`, guarded by `server/tests/security.fixes.test.js`:

- SMS: parent passwords are masked in the log, and rows are claimed before sending.
- M-Pesa prompts: they only go to a guardian on the learner's record, at most 3 per number every 10 minutes.
- Impersonation: platform owners can't be targeted, and the token lasts 1 hour.
- Client: `client/public/_headers` adds a CSP and other security headers.
- Brand colours: text colour is now chosen by contrast.
- Student list: the unpaged list is capped at 1,000 rows (with an `X-Truncated` header).

Still open: error tracking (needs a Sentry DSN). Dashboard and report speed were fixed on 14 Nov too (section 2a).

| # | ID | Sev | Finding | Effort |
|---|---|---|---|---|
| 1 | A2-SEC-04 | **Fixed** | Parent temporary passwords sit in the SMS log, which bursars can read, so a bursar can take over a parent account | S |
| 2 | A2-OPS-01 | **Fixed** | SMS goes out twice when 2+ server instances run (rows aren't claimed). Run a single instance until fixed. | S |
| 3 | A2-SEC-07 | **Fixed** | M-Pesa PIN prompts go to any phone, with no per-phone or per-requester limit | S |
| 4 | A2-SEC-05/06 | **Fixed** | Impersonation can target another platform owner, and its token lasts 12 hours | S |
| 5 | A2-SEC-08 | **Fixed** | No CSP or security headers on the client, and the token is in `localStorage` | S |
| 6 | A2-UX-02 | **Fixed** | School brand colours are applied with no contrast check, so a light colour gives unreadable button text (WCAG AA) | S |
| 7 | A2-PERF-01 | **Fixed** | Admin dashboard p95 705 ms at 1,484 learners (budget 500). Now 47 ms, or 8 ms from the 60 s cache (section 2a) | M |
| 8 | A2-PERF-03 | **Fixed** | Class performance report 568 ms; fee class summary 419 ms; collections report returns 977 KB. Now under 200 ms each, and collections sends 20 KB (section 2a) | M |
| 9 | A2-PERF-02 | **Fixed** | Unpaged `GET /api/students` returns every learner (676 KB at 1,484) | S |
| 10 | A2-OPS-02 | Med | No error tracking or alerting (109 `console.*` calls, no Sentry). A production fault would go unseen. | S |
| 11 | A2-SEC-03 rest | Low | Not yet done: checking payments with Daraja's Transaction Status API, and a way to issue a new callback token | M |
| 12 | Lows | Low | A2-SEC-01, 02, 09–17; A2-DATA-01–03 (A2-DATA-04 is fixed); A2-CODE-01–05; A2-UX-01, 03–05 (see the PHASE files and section 3) | S each |

## 2a. Speed fix (14 Nov): A2-PERF-01, A2-PERF-03, A2-DATA-04

Measured on the large school (`seedDemo.js --reset`, then `audit2ScaleSeed.js --factor=7 --history=2 --schools=200`): 1,484 learners, 13,230 invoices, and `fees:reconcile` says all invoices match. The script is `server/scripts/speedTimings.js`: 3 warm-up calls, then 20 timed calls, server time from the `Server-Timing` header. "Before" is the old code on the same machine and data. "After" is the worst p95 of five passes, with the dashboard cache off (`DASHBOARD_CACHE_MS=0`).

| Endpoint | Before p95 | After p95 | SQL per call, before → after | Target |
|---|---|---|---|---|
| `GET /api/dashboard/summary` (ADMIN) | 431 ms | **47 ms** (8 ms cached) | 15 → 12 (1 cached) | < 300 |
| `GET /api/dashboard/summary` (BURSAR) | 356 ms | **31 ms** (7 ms cached) | 15 → 12 | < 300 |
| `GET /api/dashboard/summary` (TEACHER) | 68 ms | **56 ms** (8 ms cached) | 14 → 10 | < 300 |
| `GET /api/reports/class-performance` (live results) | 173 ms | **190 ms**, p50 36–56 ms | 14 → 12 | < 300 |
| `GET /api/reports/class-performance` (frozen copy) | not timed | **100 ms** | 8 | < 300 |
| `GET /api/fees/reports/class-summary` | 265 ms | **86 ms** | 5 → 5 | < 300 |
| `GET /api/fees/reports/collections` (1 Jan–14 Nov) | 1,190 ms, **4,111 KB** | **127 ms, 20 KB** | 8 → 7 | < 300 ms, < 100 KB |

All rows are under target in every pass. The PHASE1 figures (705 ms and so on) came from an earlier run; the "before" column was re-measured here so both sides share a machine. The class performance worst case (190 ms) was one noisy pass; the other four were 43–88 ms.

**Same figures.** The before and after JSON were compared field by field on the seeded data. The dashboard for ADMIN, BURSAR and TEACHER, class performance and the fee class summary are identical. The new collections response matches the old data exactly: the total, each method's total, 8,274 receipts, the per-day sums for 223 days, and page 1 (the old list sorted newest first).

**What changed:**

- **Dashboard:** about 20 sequential queries are now one round of parallel ones. The 14-day trend, today's takings, this term's totals and the six classes owing most are summed in Postgres. Before, the last 14 days of payments were loaded and added up in JavaScript. A teacher's classes are looked up once, not three times.
- **Dashboard cache:** each school and viewer (one entry per teacher) is cached for 60 s (`modules/dashboard/summaryCache.js`). A school's entries clear after any successful write made in that school (a hook in `app.js`), so a payment, a reversal or a marked register shows on the next load. They also clear when an M-Pesa payment arrives (`mpesa/ingest.js`). The cache is in memory: **with more than one server instance, move it to Redis or turn it off.**
- **Class performance:** marks are read flat. Nesting the sheet and the learner under each of about 1,400 marks cost Prisma four times the query itself. The grade scale is read alongside the marks, not before them. This is the shared results engine, so the class results screen gains too.
- **Fee class summary:** one `groupBy` by class and status instead of loading every invoice of the term.
- **Collections:** the totals, the split by method and the per-day amounts (`byDay`, by the school's local day) cover the whole range, all summed in Postgres. Receipts come 50 at a time (`page`/`pageSize`, up to 200). The export still has every receipt. The client screen has a pager; printing shows the current page and points to the export for the full list.
- **Indexes:** every statement's plan was checked with `auto_explain` against the large seed. `FeePayment(schoolId, receivedAt)` and `AttendanceSession(schoolId, date)` already existed. One index was added, `FeeInvoice(schoolId, balance)` (migration `20261114150000_speed_indexes`), because the "outstanding" figure read every school's invoices. Two plans were fixed in the queries instead: the attendance marks count went back to the `AttendanceRecord(sessionId)` index, after a join had read all 30,870 of the school's records; and the marks query no longer joins `Student`, which had produced a plan probing every learner against every sheet.
- **Measuring:** with `QUERY_STATS=1` (never in production), every response carries `X-Query-Count` and `Server-Timing` (`lib/prisma.js`, `app.js`).
- **A2-DATA-04:** see Phase 3 below.

Tests: `server/tests/speed.fixes.test.js` (6 tests) covers the cache, and when it clears after API payments, reversals and M-Pesa; each teacher's own scope; the paged collections report and its export; and the security overview's day boundary.

Not covered: the payments ledger (`GET /api/fees/payments`) still builds its chart by loading up to 50,000 rows. It was 97 ms in PHASE1, so it was left as it is, but it should move to `byDay`-style SQL the same way.

## 3. Phases 3–8: what the code checks found

### Phase 3: data and logic

- **Holds:**
  - Fee reconciliation is clean on 13,230 invoices.
  - Exam ranking shares positions on ties (1, 2, 2, 4).
  - Custom grade scales must cover 0–100 with no gaps or overlaps, and decimal averages fall into the right band.
  - Client date helpers work on calendar dates, so the time zone doesn't shift them.
- **A2-DATA-04 (Low, fixed 14 Nov):** `settings/security` overview counted "today" from the server's midnight, and `dashboard.service.js` had UTC day helpers. The helpers fed nothing (every dashboard "today" already came from `schoolTime.js`) and are gone. The overview now counts from the school's midnight.
- **Indexes:** most tenant indexes start with `schoolId`. A few audit-log and join-table indexes don't. They're fine at today's sizes; re-check them with `EXPLAIN` in a full Phase 4.

### Phase 4: speed

Measured at 1,484 learners; see the PHASE1 timings table. The dashboards and the class reports were the hot spots (findings 7–9), now fixed (section 2a). The 4,000-learner run (`audit2ScaleSeed.js --factor=19`) and a load test haven't been done.

### Phase 5: reliability and ops

- **A2-OPS-02:** no error tracking or alerting (finding 10).
- **A2-OPS-03 (Low):** the SMS retry runs on `setInterval` inside the web process. The retention, reconcile and results-freeze scripts exist, but nothing schedules them. Use a Render cron job or a small worker with a lock.
- **Single instance is assumed throughout:**
  - the in-memory user and school caches,
  - the in-memory rate-limit counters,
  - the SMS timer (A2-OPS-01),
  - `migrate deploy` on every container start.

  Write down "one instance until these are fixed".
- **Not verified:** whether the nightly `backup-db.yml` actually runs. No restore drill has been done.

### Phase 6: UX and accessibility (code only, no browser pass)

- **A2-UX-02 (Medium):** brand colour contrast (finding 6).
- **A2-UX-03 (Low):** 6 icon-only buttons have no `aria-label`.
- **A2-UX-04 (Low):** 4 places still use the browser's `alert()`, though the app has its own dialogs: the audit-log export, the subscription tab (twice) and `lib/print.js`.
- **A2-UX-05 (to verify):** 132 inputs have no `id` or `aria-label` on the same line. Many will be labelled through a wrapper; an axe run in the browser would confirm.
- **Images:** both `<img>` tags have alt text.
- **Not done:** timed task walkthroughs per role, 360 px phone checks, thermal receipt printing, keyboard-only use.

### Phase 7: maintainability

- **A2-CODE-02:** the server has no lint script, so CI lints only the client.
- **A2-CODE-03:**
  - The client's API calls live in two places (`src/api/`, 18 files, and `features/*/x.api.js`).
  - Lists come back in three shapes (bare array, `{success,data}`, `{items,total}`).
- **A2-CODE-04:** there's no root README and no `.gitattributes`, so every commit warns about LF/CRLF.
- **A2-CODE-05:** the same password rule is copied in `auth.js` and `users.js`.
- **Already known from the plan:** fat route files next to `modules/`, and components over 400 lines (`FeeCashierTab` 933, `SubscriptionLimitsTab` 892).

### Phase 8: SaaS and compliance

Not reviewed beyond Audit 1's privacy work. Still to do:

- **Trial end:** what a school can still do, and that it can always export its data.
- **Billing:** how a school's plan becomes ACTIVE.
- **Data residency:** which region Neon is in.
- **School templates:** a data-processing agreement, privacy notice and consent form.

## 4. Planned but not done

| From the plan | Why it matters |
|---|---|
| Browser journeys per role, an axe run, 360 px and printing (7.1–7.7) | The UX findings above come from code only |
| Load test and the 4,000-learner run (5.2) | Peak days (Monday registers, fee day) haven't been tested |
| A restore drill from the off-site backup (6.1) | A backup that's never been restored isn't proven |
| Semgrep and gitleaks (3.10, 3.7) | Grep covered the main patterns, not everything |
| Checking the live Render env: `trust proxy`, `ALLOW_*`, `MPESA_ALLOWED_IPS` | The M-Pesa fix needs both set correctly |

## 5. Launch gate status (plan section 13)

| Gate | Status |
|---|---|
| No open Critical or High | **Met** (the M-Pesa High is fixed on `audit-2`; merge it) |
| Role × route matrix test in CI | Partly: the matrix exists (`AUDIT2_SWEEP`), but isn't in CI yet |
| Ledger invariants after load | Partly: reconcile is clean on the large seed; no load test |
| Restore drill | **Not met** |
| Error tracking and alerts | **Not met** (A2-OPS-02) |
| Strict CSP on the client | **Not met** (A2-SEC-08) |
| No secrets in logs or git | **Met** for the M-Pesa token. Seed passwords are dummy data. |
| SMS can't double-send, and has a daily cap | **Not met** (A2-OPS-01) |
| Jobs scheduled with a lock | **Not met** (A2-OPS-03) |
| Phone journeys and axe clean | Not checked |
| Privacy templates for schools | Not checked |
| One instance or many: decided | **Decide:** one, until the items in Phase 5 are fixed |

## 6. Getting this onto `main`

Commit `19f5ee0` on `audit-2` holds the plan, all reports, the sweep tools and the M-Pesa fix. Merge it with `git merge audit-2` from the main folder, where it doesn't conflict with ongoing work, or cherry-pick only the fix:

- `server/src/utils/logRedact.js`
- `server/src/app.js`
- `server/src/routes/mpesa.js`
- `server/tests/mpesa.callbacks.test.js`
- `docs/MPESA.md`

Then set `MPESA_ALLOWED_IPS` on Render before turning M-Pesa on.
