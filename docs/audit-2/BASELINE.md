# Audit 2: Phase 0 baseline

**Date:** 13 Nov 2026 · **Commit:** `05ddd5e` ("Hide modules the school's plan doesn't include"), tagged `audit-2-baseline` · **Plan:** [../AUDIT_PLAN.md](../AUDIT_PLAN.md), section 1

Every "before" number in Audit 2 comes from this page. Re-measure on the same seed and the same machine before claiming an improvement.

## Setup

- **Worktree:** the audit runs in its own folder, `../granite-sms-audit`, on branch `audit-2`. The building folder (`granite-sms V1`, on `main`) isn't touched.
- **Database:** a throwaway container `granite_audit2_db`, Postgres 16, on `127.0.0.1:55433`. It holds three databases:
  - `granite_audit2_demo`: the demo seed
  - `granite_audit2_test`: the test suite
  - `granite_audit2_shadow`: drift checks

  This is a separate container from `granite_audit_db` (port 55432), which the building sessions use, so neither wipes the other.
- **Env:** the worktree's `server/.env` points only at that container (it's ignored by git). The API runs on port 5055.
- **Seed:** `seed:demo --confirm-write --reset`. That gives Mwangaza Academy: 212 students, 630 invoices, 1,189 payments, 168 attendance registers (4,410 records), 72 exam sessions (64 published), 504 marksheets and 13,230 marks.

## 1. Tests and coverage

`npx vitest run --coverage` (v8), server only.

| | Result |
|---|---|
| Test files | 32 passed of 32 |
| Tests | **183 passed of 183** (up from 154 at the end of Audit 1) |
| Duration | 121 s |
| Statements | 60.9% (4,022 / 6,604) |
| **Lines** | **63.6%** (3,647 / 5,736) |
| **Branches** | **47.6%** (2,665 / 5,594) |
| Functions | 72.9% (628 / 861) |

The client has no tests.

**Coverage by area** (lines, branches). The areas that matter most are in bold.

| Area | Lines total | Lines | Branches |
|---|---|---|---|
| `utils/export.js` (CSV/XLSX export, formula-injection risk) | 20 | **5%** | **0%** |
| `modules/reports` | 53 | **6%** | 0% |
| `routes/subjects.js` | 53 | 11% | 0% |
| `routes/classTeachers.js` | 43 | 12% | 0% |
| `routes/assignments.js` | 39 | 15% | 0% |
| `middleware/features.js` (plan gating) | 37 | **16%** | 11% |
| `routes/schools.js` (platform admin) | 85 | **28%** | 15% |
| `routes/classes.js` | 152 | 36% | 30% |
| **`routes/users.js`** (where the Audit 1 admin takeover was) | 205 | **36%** | **20%** |
| `routes/settings/*` | 791 | 42% | 24% |
| **`routes/auth.js`** | 153 | **49%** | 41% |
| `middleware/auth.js` | 57 | 49% | 40% |
| `modules/attendance` | 412 | 58% | 41% |
| `services/backup.service.js` | 196 | 58% | 36% |
| **`routes/fees/*`** (money) | 657 | **62%** | **51%** |
| `modules/dashboard` | 168 | 62% | 42% |
| `routes/students.js` | 222 | 68% | 60% |
| `modules/exams` | 621 | 80% | 60% |
| `routes/mpesa.js` | 109 | 81% | 56% |
| `middleware/tenant.js` | 79 | 82% | 70% |
| `modules/fees/ledger.js` | 59 | 98% | 83% |
| `modules/privacy`, `routes/notices.js`, `utils/schoolTime.js`, `middleware/session.js` | | 100% | 75–84% |

**What this means:** the ledger core is well tested, but half the branches in the fee routes around it aren't. The routes for user accounts, sign-in and the platform admin are the least tested of all, which is where the worst Audit 1 findings were. Phase 2 starts there.

## 2. Lint and build

| | Result |
|---|---|
| Client lint (`eslint .`) | 0 errors, 12 warnings (React Compiler `incompatible-library` on `form.watch()`, and `exhaustive-deps`) |
| Server lint | No linter configured (plan 8.1) |
| Client build | Passes in 41 s |
| Main bundle `index-*.js` | 438.2 KB, **142.7 KB gzipped** (Audit 1: 131 KB gzipped, so about 9% bigger) |
| `SettingsPage` chunk | 131.9 KB, 31.2 KB gzipped |
| `schemas` chunk (zod) | 113.9 KB, 34.6 KB gzipped |
| `FeesPage` chunk | 81.1 KB, 19.9 KB gzipped |

## 3. Dependencies (`npm audit`)

| App | Production dependencies | All dependencies |
|---|---|---|
| Server | 3 high, 2 moderate | same |
| Client | **0** | **0** |

The server findings:

| Package | Severity | Fix |
|---|---|---|
| `prisma`, `@prisma/config`, `deepmerge-ts` | high | `prisma@7` (major: the deferred Prisma 7 migration) |
| `exceljs`, `uuid` | moderate | npm suggests `exceljs@3.4.0`, which is a downgrade. Assess whether import and export reach the vulnerable code, or switch library. |

`npm audit --omit=dev` lists `prisma` under production dependencies, although `package.json` has it under dev dependencies. Check why in Phase 2 (3.10); it's probably the Dockerfile's separate install path, or a lockfile quirk.

## 4. Endpoint timings

These are the 27 GET endpoints the screens call most, each called by the role that uses it. Each got 3 warm-up calls, then 20 timed calls, one at a time, from the same machine as the API and database. So the numbers are almost pure server time, with no network. Rate limits were raised for this run only, and `NODE_ENV=test` turned off the request log.

**Data size:** the demo seed. That's a *small* school; the large-school seed (plan 2.3) comes in Phase 1.

| Role | Endpoint | Status | p50 ms | p95 ms | KB |
|---|---|---|---|---|---|
| ADMIN | `GET /api/me` | 200 | 20 | 41 | 0.6 |
| ADMIN | `GET /api/dashboard/summary` | 200 | 79 | **281** | 3.3 |
| TEACHER | `GET /api/dashboard/summary` | 200 | 44 | 96 | 1.4 |
| ADMIN | `GET /api/dashboard/activity` | 200 | 31 | 47 | 5.8 |
| ADMIN | `GET /api/students` (no `page`) | 200 | 48 | 59 | **96.2** |
| ADMIN | `GET /api/students?page=1&pageSize=50` | 200 | 25 | 40 | 22.9 |
| ADMIN | `GET /api/students/:id` | 200 | 19 | 24 | 0.7 |
| ADMIN | `GET /api/classes` | 200 | 19 | 23 | 2.0 |
| BURSAR | `GET /api/fees/invoices` (no `page`) | 200 | **270** | **714** | **857.4** |
| BURSAR | `GET /api/fees/invoices?page=1&pageSize=50` | 200 | 33 | 55 | 17.4 |
| BURSAR | `GET /api/fees/invoices/:id` | 200 | 41 | 66 | 2.8 |
| BURSAR | `GET /api/fees/payments?page=1&pageSize=50` | 200 | 38 | 57 | 21.1 |
| BURSAR | `GET /api/fees/students/:id/statement` | 200 | 54 | 71 | 6.9 |
| BURSAR | `GET /api/fees/reports/defaulters?year=2026&term=TERM3` | 200 | 45 | 52 | 11.3 |
| BURSAR | `GET /api/fees/reports/collections?from=2026-09-01&to=2026-11-13` | 200 | 80 | 205 | **146.6** |
| BURSAR | `GET /api/fees/reports/class-summary?year=2026&term=TERM3` | 200 | 51 | 164 | 2.1 |
| BURSAR | `GET /api/fees/payments/:id/receipt.pdf` | 200 | 66 | 82 | 1.7 |
| TEACHER | `GET /api/attendance/sessions` | 200 | 59 | 72 | 33.1 |
| TEACHER | `GET /api/attendance/sessions/:id` | 200 | 47 | 57 | 7.7 |
| ADMIN | `GET /api/attendance/defaulters` | 400 | — | — | — |
| ADMIN | `GET /api/exams/sessions` | 200 | 36 | 50 | 39.8 |
| ADMIN | `GET /api/exams/sessions/:id/marksheets` | 200 | 38 | 97 | 3.6 |
| ADMIN | `GET /api/exams/marksheets/:id` | 200 | 47 | 62 | 8.4 |
| ADMIN | `GET /api/reports/class-performance?sessionId=:id` | 200 | 82 | 152 | 5.4 |
| PARENT | `GET /api/portal/learners` | 200 | 33 | 50 | 0.7 |
| ADMIN | `GET /api/notices` | 200 | 16 | 21 | 1.7 |
| ADMIN | `GET /api/settings/audit-logs` | 200 | 22 | 26 | 23.6 |

The attendance defaulters call got a 400 because it needs `classId`; that was my test's mistake, not a bug. Re-time it with a class in Phase 1.

**Against the plan's budgets (5.1):** at this small size, everything paged is inside 300 ms p95. Two things to watch at large-school size:

- **The unpaged invoice list.** It only pages when `?page` is sent; without it, it returns up to 500 invoices with lines: 857 KB and 714 ms p95 for 630 invoices. (Corrected in Phase 1: it's capped at 500 rows, not unbounded. See A2-DATA-01 in PHASE1.md.) The screens only call it unpaged from the cashier, filtered to one student, so normal use is fine. But any signed-in bursar (or a script) can still pull the whole lot. At 6,000+ invoices this is Audit 1's H10 problem again, through a side door. The same applies to `/api/students` without `page` (96 KB for 212 students).
- **The admin dashboard** p95 of 281 ms is already near budget at 212 students. It needs a query count in Phase 4.

## 5. Environments

Variable names only; no values were read or recorded.

| Environment | What | Config |
|---|---|---|
| Local dev (building folder) | `server/.env`: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_EXPIRES_IN`, `JWT_ALGORITHM` | **`DATABASE_URL` points at a cloud Neon database** (`neondb` on the `us-east-1` pooler), not a local one |
| Local dev client | `client/.env`: `VITE_API_BASE_URL`, `ALLOW_IMPERSONATION` | The code reads `VITE_API_URL` (Audit 1 M11 picked that one), so this file's API variable does nothing and the client falls back to `localhost:5000`. `ALLOW_IMPERSONATION` is a server setting in the client's file. |
| Demo API | Render, `granite-sms-demo-api.onrender.com` | `DEMO_MODE`, demo Neon DB (`DEMO_DATABASE_URL` secret) |
| Demo client | Cloudflare (`wrangler.demo.jsonc`) | `VITE_DEMO_MODE`, `VITE_API_URL`, `VITE_PORTFOLIO_URL`. `public/` has `_redirects` but **no `_headers`** (so no CSP; plan 3.8) |
| Production | Not deployed yet. `docs/MPESA.md` gives `granite-sms.onrender.com` as an example. | |
| Nightly backup | `backup-db.yml`, cron 23:00 UTC (02:00 Nairobi) | Secrets: `PROD_DATABASE_URL`, `BACKUP_PASSPHRASE`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` |
| Demo refresh | `refresh-demo.yml`, cron 00:10 UTC | Secret: `DEMO_DATABASE_URL` |
| CI | `ci.yml` on every push and PR | Postgres service, drift check, server tests, client lint and build. **No server lint, no coverage, no E2E.** |

Env vars the server code reads: 32 distinct `process.env.*` names. Only `JWT_SECRET` is checked at boot (plan 3.7).

**Answered (13 Nov):** the Neon database in the building folder's `server/.env` is a **dev branch**, not production. So Audit 1's M12 isn't open, and this isn't a finding. Keep it that way: production's connection string should only ever exist in Render's env and the `PROD_DATABASE_URL` GitHub secret, never in a local `.env`. Phase 2 (3.7) checks that nothing else on this machine or in git history holds it.

## 6. Leads from Phase 0, added to the plan's appendix

| Lead | Phase |
|---|---|
| `GET /api/fees/invoices` and `GET /api/students` return everything when `page` is missing (see section 4) | 3.9 / 5.2 |
| List responses come in three shapes: bare array (students, invoices, attendance sessions), `{ success, data }` (exams), `{ items, total, page, pageSize }` (payments) | 8.1 |
| Seeded receipt numbers look random (`RCPT-20261113-9E490672`). Check whether new receipts use the sequential `DocumentCounter` from Audit 1 M6. | 2.1 (M6) |
| The payments list shows `receivedByName` as the cashier's **email**, not their name | 7.8 / M6 |
| Seeding needs `prisma generate` run first in a fresh checkout; it fails with "did not initialize" otherwise. Add it to the README setup steps. | 8.5 |

## Left running

- The container `granite_audit2_db` (port 55433) is left running for Phase 1. Remove it with `docker rm -f granite_audit2_db`.
- The worktree `../granite-sms-audit` (branch `audit-2`). Remove it with `git worktree remove ../granite-sms-audit` from the main folder.
- Audit scripts (`tokens.mjs`, `timings.mjs`) are in the session scratchpad, not the repo. Phase 1 moves the useful ones into `docs/audit-2/scripts/`.
