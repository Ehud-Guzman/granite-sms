-- Timetable, flexible: several bell schedules (per class) with periods that
-- can run on some days only; split (option group) and combined lessons;
-- rooms as records; teacher unavailable times and a daily maximum; double
-- lessons and a default room per subject. Existing data is carried over:
-- each school's periods become its default schedule, room names become rooms.
-- Teacher/room clashes are now checked by time overlap under a per-school
-- lock (classes can keep different times), so those two unique keys go.

CREATE TABLE "TimetableSchedule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableSchedule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TeacherBlock" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "startsAt" VARCHAR(5) NOT NULL,
    "endsAt" VARCHAR(5) NOT NULL,
    "note" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherBlock_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Class" ADD COLUMN "timetableScheduleId" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "maxLessonsPerDay" INTEGER;
ALTER TABLE "TeachingAssignment" ADD COLUMN "doublesPerWeek" INTEGER, ADD COLUMN "optionBlock" VARCHAR(30), ADD COLUMN "roomId" TEXT;
ALTER TABLE "TimetablePeriod" ADD COLUMN "days" INTEGER[] DEFAULT ARRAY[]::INTEGER[], ADD COLUMN "scheduleId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "group" VARCHAR(30) NOT NULL DEFAULT '', ADD COLUMN "linkId" VARCHAR(40), ADD COLUMN "roomId" TEXT;

-- Carry over: one default schedule per school that already has periods.
INSERT INTO "TimetableSchedule" ("id", "schoolId", "name", "isDefault", "updatedAt")
SELECT 'tts_' || md5("schoolId"), "schoolId", 'School day', true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "schoolId" FROM "TimetablePeriod") s;
UPDATE "TimetablePeriod" SET "scheduleId" = 'tts_' || md5("schoolId");
ALTER TABLE "TimetablePeriod" ALTER COLUMN "scheduleId" SET NOT NULL;

-- Carry over: room names become rooms.
INSERT INTO "Room" ("id", "schoolId", "name", "updatedAt")
SELECT 'room_' || md5("schoolId" || '|' || "room"), "schoolId", "room", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "schoolId", "room" FROM "Lesson" WHERE "room" IS NOT NULL) r;
UPDATE "Lesson" SET "roomId" = 'room_' || md5("schoolId" || '|' || "room") WHERE "room" IS NOT NULL;
ALTER TABLE "Lesson" DROP COLUMN "room";

DROP INDEX IF EXISTS "Lesson_classId_day_periodId_key";
DROP INDEX IF EXISTS "Lesson_schoolId_room_year_day_periodId_key";
DROP INDEX IF EXISTS "Lesson_teacherId_year_day_periodId_key";
DROP INDEX IF EXISTS "TimetablePeriod_schoolId_position_key";
CREATE UNIQUE INDEX "TimetableSchedule_schoolId_name_key" ON "TimetableSchedule"("schoolId", "name");
CREATE UNIQUE INDEX "Room_schoolId_name_key" ON "Room"("schoolId", "name");
CREATE INDEX "TeacherBlock_schoolId_teacherId_idx" ON "TeacherBlock"("schoolId", "teacherId");
CREATE INDEX "Lesson_teacherId_idx" ON "Lesson"("teacherId");
CREATE INDEX "Lesson_linkId_idx" ON "Lesson"("linkId");
CREATE UNIQUE INDEX "Lesson_classId_day_periodId_group_key" ON "Lesson"("classId", "day", "periodId", "group");
CREATE UNIQUE INDEX "TimetablePeriod_scheduleId_position_key" ON "TimetablePeriod"("scheduleId", "position");
ALTER TABLE "Class" ADD CONSTRAINT "Class_timetableScheduleId_fkey" FOREIGN KEY ("timetableScheduleId") REFERENCES "TimetableSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimetablePeriod" ADD CONSTRAINT "TimetablePeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TimetableSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimetableSchedule" ADD CONSTRAINT "TimetableSchedule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherBlock" ADD CONSTRAINT "TeacherBlock_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherBlock" ADD CONSTRAINT "TeacherBlock_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TeacherBlock" ADD CONSTRAINT "TeacherBlock_day_check" CHECK ("day" BETWEEN 1 AND 6);
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_maxLessonsPerDay_check" CHECK ("maxLessonsPerDay" IS NULL OR "maxLessonsPerDay" BETWEEN 1 AND 16);
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_doublesPerWeek_check" CHECK ("doublesPerWeek" IS NULL OR "doublesPerWeek" BETWEEN 0 AND 10);
