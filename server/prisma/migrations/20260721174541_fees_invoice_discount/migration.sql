-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountedAt" TIMESTAMP(3),
ADD COLUMN     "discountedBy" TEXT;
