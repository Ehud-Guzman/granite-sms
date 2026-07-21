/*
  Warnings:

  - You are about to drop the `ExamResultPublish` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StudentExamResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubjectExamResult` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ExamResultPublish" DROP CONSTRAINT "ExamResultPublish_schoolId_fkey";

-- DropTable
DROP TABLE "ExamResultPublish";

-- DropTable
DROP TABLE "StudentExamResult";

-- DropTable
DROP TABLE "SubjectExamResult";

-- DropEnum
DROP TYPE "ExamResultStatus";
