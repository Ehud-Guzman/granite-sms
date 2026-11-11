-- CreateEnum
CREATE TYPE "ReversalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "FeeReversalRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "ReversalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "FeeReversalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeReversalRequest_schoolId_status_requestedAt_idx" ON "FeeReversalRequest"("schoolId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "FeeReversalRequest_paymentId_idx" ON "FeeReversalRequest"("paymentId");

-- AddForeignKey
ALTER TABLE "FeeReversalRequest" ADD CONSTRAINT "FeeReversalRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReversalRequest" ADD CONSTRAINT "FeeReversalRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

