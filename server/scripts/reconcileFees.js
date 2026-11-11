// Finds invoices whose stored paid/balance don't match their payment rows.
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
  SELECT i.id, i."schoolId", i."invoiceNo", i.status, i.total, i.discount, i.paid, i.balance,
         COALESCE(SUM(p.amount) FILTER (WHERE NOT p."isReversed"), 0)::int AS actual_paid
  FROM "FeeInvoice" i
  LEFT JOIN "FeePayment" p ON p."invoiceId" = i.id
  GROUP BY i.id
  HAVING i.paid <> COALESCE(SUM(p.amount) FILTER (WHERE NOT p."isReversed"), 0)
      OR (i.status <> 'VOID' AND i.balance <> GREATEST(i.total - i.discount - COALESCE(SUM(p.amount) FILTER (WHERE NOT p."isReversed"), 0), 0))
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
      `actual paid=${r.actual_paid}${overpaid ? "  ** OVERPAID — refund or credit needed **" : ""}`
  );
}

if (!FIX) {
  console.log("\nNothing changed. Re-run with --fix to rewrite stored totals from the payment rows.");
  process.exit(0);
}

for (const r of rows) {
  const payable = Math.max(r.total - r.discount, 0);
  const balance = r.status === "VOID" ? 0 : Math.max(payable - r.actual_paid, 0);
  const status =
    r.status === "VOID" ? "VOID" : balance === 0 ? "PAID" : r.actual_paid > 0 ? "PARTIALLY_PAID" : "ISSUED";
  await prisma.feeInvoice.update({
    where: { id: r.id },
    data: { paid: r.actual_paid, balance, status },
  });
}
console.log(`\nFixed ${rows.length} invoice(s). Overpaid ones still need a refund or credit decision.`);
await prisma.$disconnect();
