-- New register rows start unmarked instead of PRESENT (audit M2).
ALTER TABLE "AttendanceRecord" ALTER COLUMN "status" SET DEFAULT 'UNMARKED';
