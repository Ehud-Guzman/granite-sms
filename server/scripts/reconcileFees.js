// Finds invoices whose stored paid/balance don't match the payments
// allocated to them (FeePaymentAllocation from non-reversed payments).
// Before the payment-locking fix, simultaneous payments could leave invoices
// like this. Read-only by default; pass --fix to rewrite the stored totals
// from the payment rows (the rows themselves are never changed).
//
//   node scripts/reconcileFees.js          # report only
//   node scripts/reconcileFees.js --fix    # report and repair
import dotenv from "dotenv";
dotenv.config();

const { prisma } = await import("../src/lib/prisma.js");
const FIX = process.argv.includes("--fix");

const rows = await prisma.$queryRaw`
  WITH paid AS (
    SELECT a."invoiceId", SUM(a.amount)::int AS actual
    FROM "FeePaymentAllocation" a JOIN "FeePayment" p ON p.id = a."paymentId"
    WHERE NOT p."isReversed"
    GROUP BY a."invoiceId"
  )
  SELECT i.id, i."schoolId", i."invoiceNo", i.status, i.total, i.discount, i.paid, i.balance,
         COALESCE(paid.actual, 0) AS actual_paid
  FROM "FeeInvoice" i LEFT JOIN paid ON paid."invoiceId" = i.id
  WHERE i.paid <> COALESCE(paid.actual, 0)
     OR (i.status <> 'VOID' AND i.balance <> GREATEST(i.total - i.discount - COALESCE(paid.actual, 0), 0))
  ORDER BY i."schoolId", i."invoiceNo"`;

if (!rows.length) {
  console.log("All invoices match their payments.");
  process.exit(0);
}

console.log(`${rows.length} invoice(s) don't match their payments:`);
for (const r of rows) {
  const overpaid = r.actual_paid > r.total - r.discount;
  console.log(
    `  ${r.schoolId}  ${r.invoiceNo}  stored paid=${r.paid} balance=${r.balance}  ` +
      `actual paid=${r.actual_paid}${overpaid ? "  ** OVERPAID: --fix moves the excess to credit **" : ""}`
  );
}

if (!FIX) {
  console.log("\nNothing changed. Re-run with --fix to rewrite stored totals from the payment rows.");
  process.exit(0);
}

// Repair: an overpaid invoice keeps only what it was owed; the excess
// allocations are trimmed (newest first), which leaves that money on the
// learner's account as credit. Then stored totals are rewritten.
const { recomputeInvoice } = await import("../src/modules/fees/ledger.js");
let trimmed = 0;
for (const r of rows) {
  await prisma.$transaction(async (tx) => {
    const payable = r.status === "VOID" ? 0 : Math.max(r.total - r.discount, 0);
    let excess = r.actual_paid - payable;
    if (excess > 0) {
      const allocs = await tx.feePaymentAllocation.findMany({
        where: { invoiceId: r.id, payment: { isReversed: false } },
        orderBy: { createdAt: "desc" },
      });
      for (const a of allocs) {
        if (excess <= 0) break;
        const cut = Math.min(excess, a.amount);
        if (cut === a.amount) await tx.feePaymentAllocation.delete({ where: { id: a.id } });
        else await tx.feePaymentAllocation.update({ where: { id: a.id }, data: { amount: a.amount - cut } });
        excess -= cut;
        trimmed += cut;
      }
    }
    await recomputeInvoice(tx, r.id);
  });
}
console.log(`
Fixed ${rows.length} invoice(s). ${trimmed} moved from overpaid invoices to learners' credit.`);
await prisma.$disconnect();
