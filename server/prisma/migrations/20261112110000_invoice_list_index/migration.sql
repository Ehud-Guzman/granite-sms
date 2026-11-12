-- CreateIndex
CREATE INDEX "FeeInvoice_schoolId_year_term_createdAt_idx" ON "FeeInvoice"("schoolId", "year", "term", "createdAt");

