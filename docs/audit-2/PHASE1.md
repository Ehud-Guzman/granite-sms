# Audit 2: Phase 1 results (regression of Audit 1)

**Date:** 14 Nov 2026 · **Commit:** `audit-2-baseline` (`05ddd5e`) · **Plan:** [../AUDIT_PLAN.md](../AUDIT_PLAN.md), section 2

## Verdict

**The Audit 1 fixes hold.** No Critical or High problem came back. The every-route sweeps found:

- no cross-school leak, change or link,
- no route accepting a revoked, signed-out or password-change-required session,
- no 500 on junk input,
- no read that writes data.

What Phase 1 did turn up is all Medium or Low, mostly speed at large-school size (section 4).

## 1. How it was checked

1. **Existing tests mapped to Audit 1.** Each Audit 1 item was matched to the test that guards it, and all 183 tests pass (Phase 0). These tests check the fix on the route where the problem was found.
2. **Every-route sweeps.** Written for this audit (`server/tests/audit2/sweep.test.js`). They walk all **171 routes** from the running app (`tests/audit2/routeMap.js`), so a route added later is checked too. They run only when `AUDIT2_SWEEP=1` is set, so a normal `npm test` and CI skip them.
   - **Victim:** Mwangaza Academy from the demo seed, with a record of every kind.
   - **Attacker:** a separate school's ADMIN, BURSAR, TEACHER and STUDENT.
   - **Database checks after each route:** a hash of each of Mwangaza's 41 tables, to catch any change, and a check of all 52 cross-table links, to catch a row pointing at another school's record.
3. **Large-school data.** `server/scripts/audit2ScaleSeed.js` grows the demo to **1,484 learners and 13,230 invoices over 3 years, plus 200 small schools**. `fees:reconcile` was clean afterwards.

## 2. Sweep results

| Sweep | Scope | Result |
|---|---|---|
| Signed out | 161 non-public routes | **All 401** |
| Password change required | 169 routes × ADMIN and SYSTEM_ADMIN | **Nothing accepted** |
| Revoked session (`tokenVersion` bumped) | 161 routes | **All refused** (2 exceptions below, neither is a hole) |
| Cross-school | 4 attacker roles × every route. Victim ids go in the path, the query and the body. | **0 leaks, 0 changes to Mwangaza (41 tables hashed after every route), 0 cross-school links, 0 server errors** |
| Reads write nothing (M9) | Every GET × 5 Mwangaza roles, large school, triggers on every table | **Nothing but audit-log rows**, and only for receipts, fee reports and data exports (intended) |
| Bad input (M1) | Every route × ADMIN and BURSAR: junk queries, wrong-typed bodies, arrays, 20 KB strings | **0 server errors** |

Raw output: `phase1-sweep.json` (cross-school) and `phase1-sweep-reads-input.json` (reads and bad input).

**Not covered by the sweep:** four routes had no victim record to aim at, because the demo has no reversal requests and no grade scales:

- `POST /api/fees/reversal-requests/:id/approve` and `/reject`
- `PUT /api/grade-scales/:id` and `DELETE /api/grade-scales/:id`

Both areas already have cross-school tests (`fees.controls.test.js`, `grade.scales.test.js`). The sweep's seed should still gain one of each (Phase 2).

**A note on the first run:** the first full sweep ran for 11 hours and reported Mwangaza's tables as changed. That was a test-harness fault, not an app bug. The cross-school step hit its 10-minute timeout, kept running in the background, and its "after" snapshot picked up the bad-input sweep's writes to Mwangaza by Mwangaza's own admin. The clean re-run, with a hash after every route, showed no change. Timeouts are now 2 hours, and each sweep is run on its own.

## 3. Audit 1 status, re-checked

| Audit 1 | Re-checked by | Status |
|---|---|---|
| C1 concurrent payments | `fees.payments`, `fees.ledger`, `fees.receipts` tests; reconcile clean on 13,230 invoices | Holds |
| C2 backups / REPLACE | `backup.restore` test (REPLACE refused) | Holds. **Not checked:** whether `backup-db.yml` actually runs every night on GitHub (`gh` isn't installed here) |
| C3 drift | `db:drift` | Holds: migrations match the schema |
| C4 admin takeover | `auth.accounts` test; the sweep | Holds |
| H1 forced password change | Sweep, all 169 routes | Holds everywhere |
| H2 sessions | Sweep, all routes | Holds |
| H3/H4 limits, lockout | `auth.login` tests | Holds |
| H5–H7 fee controls | `fees.controls` tests | Holds |
| H9 frozen results | `exams.results` test | Holds |
| H10 list size | Timings at 1,484 learners | Partly. Paged lists are fine; see A2-PERF-01 and 02 |
| M1 bad input | Sweep | Holds: 0 server errors |
| M3/M4 time zone, term | `calendar` tests | Holds |
| M6 receipts | `fees.receipts` test (sequential, cashier's name) | Holds for new receipts |
| M9 reads write | Sweep | Holds |
| M14 audit IP | `small.fixes` test | Holds |
| 15 cross-school probes and new modules | Sweep, all routes | Holds |
| H12 dependencies | `npm audit` | Prisma 6 (high) is still open as the deferred Prisma 7 move. `exceljs` → `uuid` isn't reachable: exceljs only calls `v4()` without a buffer. |

## 4. New findings

| ID | Severity | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|---|
| A2-PERF-01 | Medium | **The admin dashboard is over budget at large-school size**: p95 705 ms against a 500 ms budget. It was 281 ms at 212 learners, so it grows with school size. The teacher dashboard: 439 ms. | Timings below | Count the queries per request (Phase 4). Pre-aggregate the fee totals or cache them for 30–60 s. | M |
| A2-PERF-02 | Medium | **`GET /api/students` with no `page` returns every learner**: 676 KB for 1,484, about 1.8 MB at 4,000. The screens always filter by class, but nothing on the server stops an unfiltered call. | `routes/students.js` | Cap it, or require `classId` or `page`. | S |
| A2-PERF-03 | Medium | **The class performance report and the fee class summary are slow at size**: p95 568 ms and 419 ms. The collections report returns 977 KB for about 10 weeks. | Timings below | Look at the queries (Phase 4). Page the collections report or send summary rows only. | M |
| A2-DATA-01 | Low | **The invoice list without `page` stops at 500 rows without saying so.** This corrects the Phase 0 lead: it is capped, not unbounded. A caller asking for a big school's invoices gets 500 of 13,230 with no sign the list is incomplete. | `routes/fees/invoices.routes.js` (`take: 500`) | Return a `truncated` flag or a total, or refuse an unfiltered request. | S |
| A2-DATA-02 | Low | **`PUT /api/grade-scales/assign` half-applies.** It updates the classes that match, and only then returns 400 if some ids weren't found. | `routes/gradeScales.js` `/assign` | Check the count first, or run it in a transaction. | S |
| A2-SEC-01 | Low | **`/api/auth/change-password` validates the body before checking the session**, so a revoked token gets 400 instead of 401. That's not a hole: the session check runs before anything changes. But it's the only route that does this. | `routes/auth.js:406` | Move `sessionProblem` to the top. | S |
| A2-CODE-01 | Low | **The `/api/auth/admin/create-user` stub still answers** (410 "Deprecated"), even without signing in. | `routes/auth.js` | Delete it. | S |
| A2-UX-01 | Low | **The payments list shows the cashier's email in `receivedByName`.** The receipt itself shows the name (M6). | `GET /api/fees/payments` | Use the staff member's name. | S |
| A2-DATA-03 | Low | **The attendance defaulters report answers 200 with `[]` for a `classId` that doesn't exist.** | `GET /api/attendance/defaulters` | Return 404 for an unknown class. | S |

## 5. Timings at large-school size

1,484 learners, 13,230 invoices, the same 27 endpoints as in Phase 0. 3 warm-up calls, then 20 timed calls, server time on the same machine. Rows are in bold where they're over the plan's budget or more than 2× slower than Phase 0.

| Endpoint | Phase 0 p95 (212 learners) | Phase 1 p95 (1,484) | KB at 1,484 |
|---|---|---|---|
| `GET /api/me` | 41 | 35 | 0.6 |
| **`GET /api/dashboard/summary` (ADMIN)** | 281 | **705** | 3.4 |
| **`GET /api/dashboard/summary` (TEACHER)** | 96 | **439** | 1.4 |
| **`GET /api/students` (no page)** | 59 | **413** | **675.6** |
| `GET /api/students?page=1&pageSize=50` | 40 | 77 | 23.0 |
| `GET /api/fees/invoices` (no page, capped at 500) | 714 | 525 | 845.5 |
| `GET /api/fees/invoices?page=1&pageSize=50` | 55 | 149 | 17.6 |
| `GET /api/fees/payments?page=1&pageSize=50` | 57 | 97 | 21.2 |
| `GET /api/fees/students/:id/statement` | 71 | 122 | 18.1 |
| `GET /api/fees/reports/defaulters` | 52 | 61 | 11.2 |
| **`GET /api/fees/reports/collections`** | 205 | 280 | **976.9** |
| **`GET /api/fees/reports/class-summary`** | 164 | **419** | 2.2 |
| `GET /api/fees/payments/:id/receipt.pdf` | 82 | 88 | 1.6 |
| `GET /api/attendance/sessions` | 72 | 124 | 33.2 |
| `GET /api/exams/marksheets/:id` | 62 | 244 | 54.9 |
| **`GET /api/reports/class-performance`** | 152 | **568** | 29.4 |
| `GET /api/portal/learners` (PARENT) | 50 | 72 | 0.7 |
| `GET /api/settings/audit-logs` | 26 | 51 | 23.2 |

Everything else stayed under 125 ms.

## 6. What Phase 1 added to the repo (branch `audit-2`, not committed)

- `server/tests/audit2/routeMap.js`: lists every route from the running app. Phase 2's role matrix builds on it.
- `server/tests/audit2/setup.js` and `sweep.test.js`: the sweeps, run only when `AUDIT2_SWEEP=1` is set.
- `server/scripts/audit2ScaleSeed.js`: the large-school data. It refuses any database without "audit" in its name.

Run them:

```sh
cd server
# cross-school, sessions, reads and bad input, on the demo seed
AUDIT2_SWEEP=1 TEST_DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:55433/granite_audit2_demo_test npx vitest run tests/audit2/sweep.test.js
# large school
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:55433/<db with audit+demo in the name> node prisma/seedDemo.js --confirm-write --reset
DATABASE_URL=... node scripts/audit2ScaleSeed.js --factor=7 --history=2 --schools=200
```

## 7. Left for later phases

- Check that `backup-db.yml` has actually run every night on GitHub (you, or install `gh`).
- Add a reversal request and a grade scale to the sweep's seed, so the four uncovered routes get the cross-school check.
- The 4,000-learner run (`--factor=19`) for Phase 4.
- Phase 2 (security) starts from the role × route matrix, built on `routeMap.js`.

## Databases left in the container `granite_audit2_db` (port 55433)

| Database | Holds |
|---|---|
| `granite_audit2_demo` | Demo seed, used for the Phase 0 timings |
| `granite_audit2_test` | Normal test suite |
| `granite_audit2_shadow` | Drift checks |
| `granite_audit2_demo_test` | Demo plus sweep leftovers |
| `granite_audit2_large_demo_test` | Large school plus sweep leftovers |
