-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "anonymisedAt" TIMESTAMP(3),
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentBy" VARCHAR(120),
ADD COLUMN     "photoConsent" BOOLEAN NOT NULL DEFAULT false;

