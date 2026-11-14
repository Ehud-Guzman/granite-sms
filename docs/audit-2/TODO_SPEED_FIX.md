# To do: speed fix (Audit 2, A2-PERF-01 and A2-PERF-03)

**Status:** done 14 Nov 2026; results in `AUDIT_REPORT_2.md` section 2a · **Effort:** 2–3 days · **When:** before a school with more than about 800 learners. Not needed for the demo (212 learners are fast).

Start a session with: *"Do the speed fix in docs/audit-2/TODO_SPEED_FIX.md."*

## The problem

Measured at 1,484 learners and 13,230 invoices (`docs/audit-2/PHASE1.md`, section 5), p95 server time:

| Endpoint | Now | Target |
|---|---|---|
| `GET /api/dashboard/summary` (ADMIN) | 705 ms | < 300 |
| `GET /api/dashboard/summary` (TEACHER) | 439 ms | < 300 |
| `GET /api/reports/class-performance?sessionId=` | 568 ms | < 300 |
| `GET /api/fees/reports/class-summary` | 419 ms | < 300 |
| `GET /api/fees/reports/collections` | 280 ms, **977 KB** | < 300 ms, < 100 KB |

Known causes (from reading the code):

- `server/src/modules/dashboard/dashboard.service.js` makes **21 database calls** per load.
- Lines ~223 and ~425 load every recent `FeePayment` row and add them up in JavaScript (the 14-day trend and the collected totals).
- The loop at ~129 works through today's sessions one by one.
- The class reports run several queries per class or subject.

## The fix, in order

1. **Measure.** Add a dev-only Prisma query counter per request, and record the query count and time for each endpoint above.
2. **Aggregate in Postgres.**
   - Replace load-then-sum with `groupBy`/`aggregate`, or one `$queryRaw` per figure, for example `SUM(amount) … GROUP BY local day` for the 14-day trend.
   - Use the school's time zone through `utils/schoolTime.js`.
   - Also swap the UTC day helpers in `dashboard.service.js` for school time (A2-DATA-04).
3. **Cache the dashboard summary** per school and role for 60 s. Use an in-memory map like `middleware/tenant.js`, and clear it when a payment posts or is reversed. This is fine on one server; note in the code that more than one instance needs Redis.
4. **Indexes.** Run `EXPLAIN ANALYZE` on the slow queries against the large seed, and add composite indexes where Postgres scans, for example `FeePayment(schoolId, receivedAt)` and `AttendanceSession(schoolId, date)`. Add them as one migration.
5. **Class reports.** Make class performance and fee class summary one grouped query each, not one per class or subject.
6. **Collections report.** Page it (`page`/`pageSize`, as `GET /api/fees/payments` does) or return summary rows by default. Update the client screen `client/src/features/reports/fees/FeesCollectionsReport.jsx`.

## How to test it

1. Start a throwaway Postgres, for example `docker run -d --name granite_speed_db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass -p 127.0.0.1:55435:5432 postgres:16`.
2. Create a database with "audit" and "demo" in its name, for example `granite_speed_audit_demo`.
3. Build the large school:
   - `npx prisma migrate deploy`
   - `node prisma/seedDemo.js --confirm-write --reset`
   - `node scripts/audit2ScaleSeed.js --factor=7 --history=2 --schools=200`
   - `npm run fees:reconcile` must still say all invoices match.
4. Re-time the endpoints above: 3 warm-up calls, then 20 timed. Every row must be under target.
5. Run the full suite (`npm test`) and the client build.
6. Remove only the container you created (`docker rm -f -v granite_speed_db`). Don't prune other Docker data.
7. Update `docs/audit-2/AUDIT_REPORT_2.md`: mark A2-PERF-01, A2-PERF-03 and A2-DATA-04 as fixed, with before/after numbers.

## Rules while doing it

- Development continues on `main` in other sessions. Work in a separate git worktree and merge when green, and don't switch branches in the shared folder.
- Dashboard figures must stay identical. Compare before/after JSON on the seeded data for ADMIN, BURSAR and TEACHER.
