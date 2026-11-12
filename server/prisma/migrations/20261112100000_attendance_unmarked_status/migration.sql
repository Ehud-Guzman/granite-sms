-- New attendance status for learners not marked yet (audit M2).
-- Separate from the default change: Postgres cannot use a new enum value
-- in the transaction that adds it.
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'UNMARKED';
