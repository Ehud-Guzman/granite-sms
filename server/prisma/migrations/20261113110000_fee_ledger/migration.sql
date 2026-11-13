-- Fee ledger (audit M5): payments belong to a learner and are spread over
-- invoices through FeePaymentAllocation; what isn't allocated is credit.
-- Existing data keeps the same balances: every existing payment gets its
-- learner from its invoice and one allocation for its full amount.

-- 1) Payments get their learner (filled from the invoice before NOT NULL).
ALTER TABLE "FeePayment" ADD COLUMN "studentId" TEXT;
UPDATE "FeePayment" p SET "studentId" = i."studentId" FROM "FeeInvoice" i WHERE i.id = p."invoiceId";
ALTER TABLE "FeePayment" ALTER COLUMN "studentId" SET NOT NULL;
ALTER TABLE "FeePayment" ALTER COLUMN "invoiceId" DROP NOT NULL;

-- 2) Allocations.
CREATE TABLE "FeePaymentAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePaymentAllocation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "FeePaymentAllocation" ("id", "schoolId", "paymentId", "invoiceId", "amount", "createdAt")
SELECT 'alloc_' || p.id, p."schoolId", p.id, p."invoiceId", p.amount, p."createdAt"
FROM "FeePayment" p
WHERE p."invoiceId" IS NOT NULL;

CREATE INDEX "FeePaymentAllocation_paymentId_idx" ON "FeePaymentAllocation"("paymentId");
CREATE INDEX "FeePaymentAllocation_schoolId_invoiceId_idx" ON "FeePaymentAllocation"("schoolId", "invoiceId");
CREATE INDEX "FeePayment_schoolId_studentId_idx" ON "FeePayment"("schoolId", "studentId");

ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePaymentAllocation" ADD CONSTRAINT "FeePaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeePaymentAllocation" ADD CONSTRAINT "FeePaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
