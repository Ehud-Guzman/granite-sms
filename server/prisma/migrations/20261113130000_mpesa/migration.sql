-- CreateEnum
CREATE TYPE "MpesaTxnStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'ASSIGNED', 'IGNORED');

-- CreateTable
CREATE TABLE "MpesaConfig" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "shortcode" VARCHAR(12) NOT NULL,
    "kind" VARCHAR(8) NOT NULL DEFAULT 'PAYBILL',
    "environment" VARCHAR(12) NOT NULL DEFAULT 'sandbox',
    "consumerKeyEnc" TEXT,
    "consumerSecretEnc" TEXT,
    "passkeyEnc" TEXT,
    "callbackToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "urlsRegisteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpesaTransaction" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "transId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "billRef" TEXT,
    "msisdn" TEXT,
    "payerName" TEXT,
    "transTime" TIMESTAMP(3),
    "source" VARCHAR(8) NOT NULL DEFAULT 'C2B',
    "status" "MpesaTxnStatus" NOT NULL,
    "paymentId" TEXT,
    "studentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpesaStkRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "checkoutRequestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "resultDesc" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaStkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaConfig_schoolId_key" ON "MpesaConfig"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaConfig_callbackToken_key" ON "MpesaConfig"("callbackToken");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_transId_key" ON "MpesaTransaction"("transId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_paymentId_key" ON "MpesaTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "MpesaTransaction_schoolId_status_createdAt_idx" ON "MpesaTransaction"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaStkRequest_checkoutRequestId_key" ON "MpesaStkRequest"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "MpesaStkRequest_schoolId_createdAt_idx" ON "MpesaStkRequest"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "MpesaConfig" ADD CONSTRAINT "MpesaConfig_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaStkRequest" ADD CONSTRAINT "MpesaStkRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

