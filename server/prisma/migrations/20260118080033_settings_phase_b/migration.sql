-- AlterTable
ALTER TABLE "School" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" VARCHAR(30),
ADD COLUMN     "shortName" TEXT;

-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "currentAcademicYear" TEXT,
ADD COLUMN     "term1Label" TEXT NOT NULL DEFAULT 'Term 1',
ADD COLUMN     "term2Label" TEXT NOT NULL DEFAULT 'Term 2',
ADD COLUMN     "term3Label" TEXT NOT NULL DEFAULT 'Term 3';
