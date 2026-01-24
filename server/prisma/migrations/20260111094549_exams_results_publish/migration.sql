-- CreateEnum
CREATE TYPE "ExamResultStatus" AS ENUM ('PUBLISHED');

-- CreateTable
CREATE TABLE "ExamResultPublish" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "gradeScaleId" TEXT,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalsComputed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExamResultPublish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentExamResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "average" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectExamResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamResultPublish_schoolId_publishedAt_idx" ON "ExamResultPublish"("schoolId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResultPublish_schoolId_examSessionId_key" ON "ExamResultPublish"("schoolId", "examSessionId");

-- CreateIndex
CREATE INDEX "StudentExamResult_schoolId_examSessionId_idx" ON "StudentExamResult"("schoolId", "examSessionId");

-- CreateIndex
CREATE INDEX "StudentExamResult_schoolId_studentId_idx" ON "StudentExamResult"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentExamResult_schoolId_examSessionId_studentId_key" ON "StudentExamResult"("schoolId", "examSessionId", "studentId");

-- CreateIndex
CREATE INDEX "SubjectExamResult_schoolId_examSessionId_subjectId_idx" ON "SubjectExamResult"("schoolId", "examSessionId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectExamResult_schoolId_examSessionId_studentId_subjectI_key" ON "SubjectExamResult"("schoolId", "examSessionId", "studentId", "subjectId");

-- AddForeignKey
ALTER TABLE "ExamResultPublish" ADD CONSTRAINT "ExamResultPublish_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
