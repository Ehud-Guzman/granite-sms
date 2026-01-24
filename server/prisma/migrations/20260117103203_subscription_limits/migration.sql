/*
  Warnings:

  - The `planCode` column on the `Subscription` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'BASIC', 'PRO', 'ENTERPRISE');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "maxClasses" INTEGER,
ADD COLUMN     "maxStudents" INTEGER,
ADD COLUMN     "maxTeachers" INTEGER,
DROP COLUMN "planCode",
ADD COLUMN     "planCode" "PlanCode" DEFAULT 'FREE';

-- CreateIndex
CREATE INDEX "Subscription_schoolId_createdAt_idx" ON "Subscription"("schoolId", "createdAt");
