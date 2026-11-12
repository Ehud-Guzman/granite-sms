-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "currentTerm" "Term",
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi';

-- CreateTable
CREATE TABLE "TermDate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "term" "Term" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TermDate_schoolId_year_term_key" ON "TermDate"("schoolId", "year", "term");

-- AddForeignKey
ALTER TABLE "TermDate" ADD CONSTRAINT "TermDate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

