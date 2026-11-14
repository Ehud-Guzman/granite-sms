-- Timetable (feature 11): bell times, lessons, weekly targets, school days.
-- The unique keys on Lesson are the clash rules: one lesson per class per slot,
-- and a teacher / a room in one place per slot within an academic year.

-- CreateEnum
CREATE TYPE "PeriodKind" AS ENUM ('LESSON', 'BREAK');

-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "timetableDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- AlterTable
ALTER TABLE "TeachingAssignment" ADD COLUMN     "lessonsPerWeek" INTEGER;

-- CreateTable
CREATE TABLE "TimetablePeriod" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(30) NOT NULL,
    "startsAt" VARCHAR(5) NOT NULL,
    "endsAt" VARCHAR(5) NOT NULL,
    "kind" "PeriodKind" NOT NULL DEFAULT 'LESSON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetablePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "periodId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "room" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetablePeriod_schoolId_idx" ON "TimetablePeriod"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetablePeriod_schoolId_position_key" ON "TimetablePeriod"("schoolId", "position");

-- CreateIndex
CREATE INDEX "Lesson_schoolId_year_day_idx" ON "Lesson"("schoolId", "year", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_classId_day_periodId_key" ON "Lesson"("classId", "day", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_teacherId_year_day_periodId_key" ON "Lesson"("teacherId", "year", "day", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_schoolId_room_year_day_periodId_key" ON "Lesson"("schoolId", "room", "year", "day", "periodId");

-- AddForeignKey
ALTER TABLE "TimetablePeriod" ADD CONSTRAINT "TimetablePeriod_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TimetablePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Sanity checks the app also enforces.
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_day_check" CHECK ("day" BETWEEN 1 AND 6);
ALTER TABLE "TimetablePeriod" ADD CONSTRAINT "TimetablePeriod_position_check" CHECK ("position" >= 1);
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_lessonsPerWeek_check" CHECK ("lessonsPerWeek" IS NULL OR "lessonsPerWeek" BETWEEN 0 AND 20);
