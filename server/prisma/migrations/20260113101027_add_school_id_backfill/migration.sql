/*
  SAFE MULTI-TENANT BACKFILL MIGRATION (PostgreSQL / Neon / Prisma)

  Strategy:
  1) Add new columns as NULLABLE
  2) Choose a school id for backfill:
     - If any School exists -> use the oldest (createdAt asc)
     - Else create 'school_default' and use it
  3) Backfill existing rows
  4) Enforce NOT NULL
  5) Add indexes + unique constraints
  6) Add foreign keys (guarded)
*/

-- =========================================================
-- 0) ENUM: Add SYSTEM_ADMIN safely (works across versions)
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role'
      AND e.enumlabel = 'SYSTEM_ADMIN'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'SYSTEM_ADMIN';
  END IF;
END $$;


-- =========================================================
-- 0.5) Drop old indexes that conflict with new multi-tenant ones
-- =========================================================
DROP INDEX IF EXISTS "Class_name_stream_year_key";
DROP INDEX IF EXISTS "Class_year_idx";
DROP INDEX IF EXISTS "ClassTeacher_classId_key";
DROP INDEX IF EXISTS "Student_admissionNo_key";
DROP INDEX IF EXISTS "Student_classId_idx";
DROP INDEX IF EXISTS "Subject_code_key";
DROP INDEX IF EXISTS "Subject_name_key";
DROP INDEX IF EXISTS "TeachingAssignment_teacherId_classId_subjectId_key";


-- =========================================================
-- 1) ADD COLUMNS (NULLABLE FIRST)
-- =========================================================

-- Class
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- ClassTeacher
ALTER TABLE "ClassTeacher" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- FeePayment
ALTER TABLE "FeePayment" ADD COLUMN IF NOT EXISTS "clientTxnId" TEXT;

-- SchoolSettings
ALTER TABLE "SchoolSettings" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- Student
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- Subject
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- Teacher
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- TeachingAssignment
ALTER TABLE "TeachingAssignment" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;


-- =========================================================
-- 2) CHOOSE BACKFILL SCHOOL ID (existing oldest school OR create default)
-- =========================================================

-- Create default school ONLY if there are zero schools
INSERT INTO "School" ("id","name","code","isActive","createdAt","updatedAt")
SELECT 'school_default', 'Default School', NULL, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "School");

-- Pick the chosen school id:
-- - if schools exist: oldest one
-- - else: the school_default we inserted above
-- We’ll store it in a temp table for reuse.
DROP TABLE IF EXISTS "_backfill_school";
CREATE TEMP TABLE "_backfill_school" ("id" TEXT NOT NULL);

INSERT INTO "_backfill_school" ("id")
SELECT id
FROM "School"
ORDER BY "createdAt" ASC
LIMIT 1;


-- =========================================================
-- 3) BACKFILL EXISTING ROWS
-- =========================================================

-- Class
UPDATE "Class"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- Student
UPDATE "Student"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- Teacher
UPDATE "Teacher"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- Subject
UPDATE "Subject"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- SchoolSettings
UPDATE "SchoolSettings"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- ClassTeacher
UPDATE "ClassTeacher"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;

-- TeachingAssignment
UPDATE "TeachingAssignment"
SET "schoolId" = (SELECT "id" FROM "_backfill_school" LIMIT 1)
WHERE "schoolId" IS NULL;


-- =========================================================
-- 4) ENFORCE NOT NULL (after backfill)
-- =========================================================

ALTER TABLE "Class" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ClassTeacher" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "SchoolSettings" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Subject" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Teacher" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "TeachingAssignment" ALTER COLUMN "schoolId" SET NOT NULL;


-- =========================================================
-- 5) INDEXES + UNIQUE CONSTRAINTS (tenant-aware)
-- =========================================================

-- Class
CREATE INDEX IF NOT EXISTS "Class_schoolId_year_idx" ON "Class"("schoolId", "year");
CREATE INDEX IF NOT EXISTS "Class_schoolId_isActive_idx" ON "Class"("schoolId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "Class_schoolId_name_stream_year_key"
  ON "Class"("schoolId", "name", "stream", "year");

-- ClassTeacher (your schema had classId unique earlier; now it’s unique per school)
CREATE INDEX IF NOT EXISTS "ClassTeacher_schoolId_idx" ON "ClassTeacher"("schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClassTeacher_schoolId_classId_key"
  ON "ClassTeacher"("schoolId", "classId");

-- FeePayment idempotency: multiple NULL clientTxnId allowed in Postgres unique indexes (OK)
CREATE UNIQUE INDEX IF NOT EXISTS "FeePayment_schoolId_clientTxnId_key"
  ON "FeePayment"("schoolId", "clientTxnId");

-- SchoolSettings: 1 row per school
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolSettings_schoolId_key"
  ON "SchoolSettings"("schoolId");

-- Student
CREATE INDEX IF NOT EXISTS "Student_schoolId_classId_idx" ON "Student"("schoolId", "classId");
CREATE INDEX IF NOT EXISTS "Student_schoolId_idx" ON "Student"("schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "Student_schoolId_admissionNo_key"
  ON "Student"("schoolId", "admissionNo");

-- Subject
CREATE INDEX IF NOT EXISTS "Subject_schoolId_idx" ON "Subject"("schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "Subject_schoolId_name_key"
  ON "Subject"("schoolId", "name");
-- NOTE: if code is NULL on multiple rows, unique index is still fine in Postgres (NULLs don’t conflict)
CREATE UNIQUE INDEX IF NOT EXISTS "Subject_schoolId_code_key"
  ON "Subject"("schoolId", "code");

-- Teacher
CREATE INDEX IF NOT EXISTS "Teacher_schoolId_idx" ON "Teacher"("schoolId");

-- TeachingAssignment
CREATE INDEX IF NOT EXISTS "TeachingAssignment_schoolId_idx" ON "TeachingAssignment"("schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "TeachingAssignment_schoolId_teacherId_classId_subjectId_key"
  ON "TeachingAssignment"("schoolId", "teacherId", "classId", "subjectId");


-- =========================================================
-- 6) FOREIGN KEYS (guarded so reruns don’t crash)
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Teacher_schoolId_fkey') THEN
    ALTER TABLE "Teacher"
      ADD CONSTRAINT "Teacher_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Class_schoolId_fkey') THEN
    ALTER TABLE "Class"
      ADD CONSTRAINT "Class_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_schoolId_fkey') THEN
    ALTER TABLE "Student"
      ADD CONSTRAINT "Student_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolSettings_schoolId_fkey') THEN
    ALTER TABLE "SchoolSettings"
      ADD CONSTRAINT "SchoolSettings_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassTeacher_schoolId_fkey') THEN
    ALTER TABLE "ClassTeacher"
      ADD CONSTRAINT "ClassTeacher_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subject_schoolId_fkey') THEN
    ALTER TABLE "Subject"
      ADD CONSTRAINT "Subject_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeachingAssignment_schoolId_fkey') THEN
    ALTER TABLE "TeachingAssignment"
      ADD CONSTRAINT "TeachingAssignment_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;


-- Cleanup temp
DROP TABLE IF EXISTS "_backfill_school";
