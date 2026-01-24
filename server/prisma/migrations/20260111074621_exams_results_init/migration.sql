-- CreateEnum
CREATE TYPE "ExamSessionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MarkSheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "GradeScaleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ExamAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'UNLOCK', 'PUBLISH');

-- CreateTable
CREATE TABLE "ExamType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "weight" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "term" "Term" NOT NULL,
    "classId" TEXT NOT NULL,
    "examTypeId" TEXT NOT NULL,
    "status" "ExamSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkSheet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "status" "MarkSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "markSheetId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "isMissing" BOOLEAN NOT NULL DEFAULT true,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeScale" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "GradeScaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "gradeScaleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,
    "points" DOUBLE PRECISION,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultPublish" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "gradeScaleId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ResultPublish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "resultPublishId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "averageScore" DOUBLE PRECISION NOT NULL,
    "overallGrade" TEXT,
    "overallRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentResultId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "grade" TEXT,
    "remark" TEXT,

    CONSTRAINT "SubjectResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "ExamAuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamType_schoolId_isActive_idx" ON "ExamType"("schoolId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExamType_schoolId_name_key" ON "ExamType"("schoolId", "name");

-- CreateIndex
CREATE INDEX "ExamSession_schoolId_classId_year_term_idx" ON "ExamSession"("schoolId", "classId", "year", "term");

-- CreateIndex
CREATE INDEX "ExamSession_schoolId_status_idx" ON "ExamSession"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSession_schoolId_year_term_classId_examTypeId_key" ON "ExamSession"("schoolId", "year", "term", "classId", "examTypeId");

-- CreateIndex
CREATE INDEX "MarkSheet_schoolId_examSessionId_idx" ON "MarkSheet"("schoolId", "examSessionId");

-- CreateIndex
CREATE INDEX "MarkSheet_schoolId_teacherId_status_idx" ON "MarkSheet"("schoolId", "teacherId", "status");

-- CreateIndex
CREATE INDEX "MarkSheet_schoolId_subjectId_idx" ON "MarkSheet"("schoolId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MarkSheet_schoolId_examSessionId_subjectId_key" ON "MarkSheet"("schoolId", "examSessionId", "subjectId");

-- CreateIndex
CREATE INDEX "Mark_schoolId_studentId_idx" ON "Mark"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "Mark_markSheetId_idx" ON "Mark"("markSheetId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_schoolId_markSheetId_studentId_key" ON "Mark"("schoolId", "markSheetId", "studentId");

-- CreateIndex
CREATE INDEX "GradeScale_schoolId_status_idx" ON "GradeScale"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_schoolId_name_key" ON "GradeScale"("schoolId", "name");

-- CreateIndex
CREATE INDEX "GradeBand_schoolId_gradeScaleId_idx" ON "GradeBand"("schoolId", "gradeScaleId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_schoolId_gradeScaleId_label_key" ON "GradeBand"("schoolId", "gradeScaleId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ResultPublish_examSessionId_key" ON "ResultPublish"("examSessionId");

-- CreateIndex
CREATE INDEX "ResultPublish_schoolId_publishedAt_idx" ON "ResultPublish"("schoolId", "publishedAt");

-- CreateIndex
CREATE INDEX "StudentResult_schoolId_studentId_idx" ON "StudentResult"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentResult_schoolId_resultPublishId_studentId_key" ON "StudentResult"("schoolId", "resultPublishId", "studentId");

-- CreateIndex
CREATE INDEX "SubjectResult_schoolId_subjectId_idx" ON "SubjectResult"("schoolId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectResult_schoolId_studentResultId_subjectId_key" ON "SubjectResult"("schoolId", "studentResultId", "subjectId");

-- CreateIndex
CREATE INDEX "ExamAuditLog_schoolId_entityType_entityId_idx" ON "ExamAuditLog"("schoolId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ExamAuditLog_schoolId_actorUserId_createdAt_idx" ON "ExamAuditLog"("schoolId", "actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExamType" ADD CONSTRAINT "ExamType_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "ExamType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_markSheetId_fkey" FOREIGN KEY ("markSheetId") REFERENCES "MarkSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "GradeScale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPublish" ADD CONSTRAINT "ResultPublish_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPublish" ADD CONSTRAINT "ResultPublish_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentResult" ADD CONSTRAINT "StudentResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentResult" ADD CONSTRAINT "StudentResult_resultPublishId_fkey" FOREIGN KEY ("resultPublishId") REFERENCES "ResultPublish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_studentResultId_fkey" FOREIGN KEY ("studentResultId") REFERENCES "StudentResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAuditLog" ADD CONSTRAINT "ExamAuditLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
