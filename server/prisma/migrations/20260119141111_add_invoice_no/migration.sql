/*
  Warnings:

  - A unique constraint covering the columns `[schoolId,invoiceNo]` on the table `FeeInvoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "invoiceNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_schoolId_invoiceNo_key" ON "FeeInvoice"("schoolId", "invoiceNo");
