-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SCHOOL_SNAPSHOT',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "meta" JSONB,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Backup_schoolId_createdAt_idx" ON "Backup"("schoolId", "createdAt");
