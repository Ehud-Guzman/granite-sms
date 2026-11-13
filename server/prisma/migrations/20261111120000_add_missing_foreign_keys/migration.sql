-- Adds foreign keys and indexes that schema.prisma declares but no earlier
-- migration created (audit finding C3). Without them the database allowed
-- invoices, fee plans and attendance to point at students/classes that don't
-- exist, and deleting a student with invoices was not blocked.
--
-- Safe to run on a database where some of these already exist (e.g. one built
-- with `prisma db push`): every step checks first.

-- 1) Refuse to continue if existing rows would break the new constraints.
--    Nothing is deleted automatically: money and attendance rows need a human
--    decision. Run `npm run db:orphans` to list them.
DO $$
DECLARE
  bad_invoice_student int;
  bad_invoice_class int;
  bad_plan_class int;
  bad_session_class int;
  bad_record_student int;
BEGIN
  SELECT count(*) INTO bad_invoice_student FROM "FeeInvoice" i
    WHERE NOT EXISTS (SELECT 1 FROM "Student" s WHERE s.id = i."studentId");
  SELECT count(*) INTO bad_invoice_class FROM "FeeInvoice" i
    WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = i."classId");
  SELECT count(*) INTO bad_plan_class FROM "FeePlan" p
    WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = p."classId");
  SELECT count(*) INTO bad_session_class FROM "AttendanceSession" a
    WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = a."classId");
  SELECT count(*) INTO bad_record_student FROM "AttendanceRecord" r
    WHERE NOT EXISTS (SELECT 1 FROM "Student" s WHERE s.id = r."studentId");

  IF bad_invoice_student + bad_invoice_class + bad_plan_class + bad_session_class + bad_record_student > 0 THEN
    RAISE EXCEPTION 'Orphaned rows found (invoice->student %, invoice->class %, plan->class %, attendance session->class %, attendance record->student %). Run "npm run db:orphans" and resolve them before migrating.',
      bad_invoice_student, bad_invoice_class, bad_plan_class, bad_session_class, bad_record_student;
  END IF;
END $$;

-- A marksheet whose teacher no longer exists just becomes unassigned
-- (the relation is ON DELETE SET NULL anyway).
UPDATE "MarkSheet" m SET "teacherId" = NULL
WHERE m."teacherId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Teacher" t WHERE t.id = m."teacherId");

-- 2) Indexes
CREATE INDEX IF NOT EXISTS "User_schoolId_role_idx" ON "User"("schoolId", "role");
CREATE INDEX IF NOT EXISTS "User_schoolId_isActive_idx" ON "User"("schoolId", "isActive");

-- 3) Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeePlan_classId_fkey') THEN
    ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeInvoice_studentId_fkey') THEN
    ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeInvoice_classId_fkey') THEN
    ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceSession_classId_fkey') THEN
    ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_studentId_fkey') THEN
    ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarkSheet_teacherId_fkey') THEN
    ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
