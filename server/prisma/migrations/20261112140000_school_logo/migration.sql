-- CreateTable
CREATE TABLE "SchoolLogo" (
    "schoolId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolLogo_pkey" PRIMARY KEY ("schoolId")
);

-- AddForeignKey
ALTER TABLE "SchoolLogo" ADD CONSTRAINT "SchoolLogo_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

