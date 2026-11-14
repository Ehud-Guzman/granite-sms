-- Audit 2 speed fix (A2-PERF-01): the dashboard's "outstanding" figure sums
-- every invoice with a balance, in any year. Without this index Postgres
-- read the whole FeeInvoice table (every school's) to find them.
-- FeePayment(schoolId, receivedAt) and AttendanceSession(schoolId, date),
-- the other indexes these queries need, already exist.
CREATE INDEX "FeeInvoice_schoolId_balance_idx" ON "FeeInvoice"("schoolId", "balance");
