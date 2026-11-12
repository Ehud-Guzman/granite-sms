-- CreateEnum
CREATE TYPE "StudentExit" AS ENUM ('GRADUATED', 'TRANSFERRED', 'LEFT');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "exitDate" DATE,
ADD COLUMN     "exitNote" TEXT,
ADD COLUMN     "exitStatus" "StudentExit";

