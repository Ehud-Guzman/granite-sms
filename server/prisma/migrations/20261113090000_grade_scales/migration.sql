-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "gradeScaleId" TEXT;

-- AlterTable
ALTER TABLE "GradeScale" ADD COLUMN     "overallBy" TEXT NOT NULL DEFAULT 'AVERAGE';

-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "defaultGradeScaleId" TEXT;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "GradeScale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

