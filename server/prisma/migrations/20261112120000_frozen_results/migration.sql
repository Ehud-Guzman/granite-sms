-- AlterEnum
ALTER TYPE "ExamAuditAction" ADD VALUE 'UNPUBLISH';

-- AlterTable
ALTER TABLE "StudentResult" ADD COLUMN     "admissionNo" TEXT,
ADD COLUMN     "missingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "position" INTEGER,
ADD COLUMN     "studentName" TEXT;

-- AlterTable
ALTER TABLE "SubjectResult" ADD COLUMN     "subjectName" TEXT,
ALTER COLUMN "score" DROP NOT NULL;

