-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "brandLogoUrl" TEXT,
ADD COLUMN     "brandPrimaryColor" TEXT,
ADD COLUMN     "brandSecondaryColor" TEXT,
ADD COLUMN     "printFooterText" TEXT,
ADD COLUMN     "printHeaderText" TEXT,
ADD COLUMN     "printShowLogo" BOOLEAN NOT NULL DEFAULT true;
