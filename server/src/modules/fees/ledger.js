// src/modules/fees/ledger.js
// A learner's fee account (audit M5). Payments belong to the learner and are
// spread over their invoices through FeePaymentAllocation:
//   invoice.paid  = its allocations from payments that aren't reversed
//   credit        = their non-reversed payments - what those payments allocated
// New money (and credit) pays the oldest unpaid invoice first, which is how
// arrears from earlier terms are cleared.
//
// Every function here runs inside a transaction (tx) after lockStudent(), so
// two cashiers taking money for one family queue instead of colliding.

const httpError = (status, message) => Object.assign(new Error(message), { status });

export function computeInvoiceStatus(total, paid, discount = 0) {
  const payable = Math.max((Number(total) || 0) - Math.max(Number(discount) || 0, 0), 0);
  const p = Math.max(Number(paid) || 0, 0);
  const balance = Math.max(payable - p, 0);
  const status = balance === 0 ? "PAID" : p > 0 ? "PARTIALLY_PAID" : "ISSUED";
  return { balance, status };
}

/** Locks the learner's row for the rest of the transaction. Returns false if not in this school. */
export async function lockStudent(tx, schoolId, studentId) {
  const rows = await tx.$queryRaw`
    SELECT id FROM "Student" WHERE id = ${String(studentId)} AND "schoolId" = ${String(schoolId)} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Locks the account an invoice belongs to (its learner) and returns the
 * invoice as it is now, or null if it isn't in this school.
 */
export async function lockInvoice(tx, schoolId, invoiceId) {
  const found = await tx.feeInvoice.findFirst({
    where: { id: String(invoiceId), schoolId: String(schoolId) },
    select: { studentId: true },
  });
  if (!found) return null;
  await lockStudent(tx, schoolId, found.studentId);
  return tx.feeInvoice.findUnique({ where: { id: String(invoiceId) } });
}

/** paid/balance/status of one invoice from its live allocations. */
export async function recomputeInvoice(tx, invoiceId) {
  const invoice = await tx.feeInvoice.findUnique({ where: { id: invoiceId } });
  const agg = await tx.feePaymentAllocation.aggregate({
    where: { invoiceId, payment: { isReversed: false } },
    _sum: { amount: true },
  });
  const paid = Number(agg._sum.amount || 0);
  if (invoice.status === "VOID") {
    return tx.feeInvoice.update({ where: { id: invoiceId }, data: { paid, balance: 0 } });
  }
  const { balance, status } = computeInvoiceStatus(invoice.total, paid, invoice.discount);
  return tx.feeInvoice.update({ where: { id: invoiceId }, data: { paid, balance, status } });
}

/** Money a payment still has to give (amount - its allocations). */
async function unallocatedOf(tx, payment) {
  const agg = await tx.feePaymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
  return payment.amount - Number(agg._sum.amount || 0);
}

/** Open invoices, oldest first: by year, then term, then when issued. */
async function openInvoices(tx, schoolId, studentId) {
  const list = await tx.feeInvoice.findMany({
    where: { schoolId, studentId, status: { not: "VOID" }, balance: { gt: 0 } },
    orderBy: [{ year: "asc" }, { term: "asc" }, { createdAt: "asc" }],
  });
  return list;
}

/**
 * Spends `amount` of a payment on invoices: the preferred one first (the
 * one the cashier picked), then the oldest unpaid. Returns allocations made.
 */
async function spend(tx, { schoolId, payment, amount, preferInvoiceId = null }) {
  let left = amount;
  const made = [];
  const invoices = await openInvoices(tx, schoolId, payment.studentId);
  if (preferInvoiceId) invoices.sort((a, b) => (a.id === preferInvoiceId ? -1 : b.id === preferInvoiceId ? 1 : 0));
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balance);
    if (take <= 0) continue;
    await tx.feePaymentAllocation.create({ data: { schoolId, paymentId: payment.id, invoiceId: inv.id, amount: take } });
    await recomputeInvoice(tx, inv.id);
    made.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, amount: take });
    left -= take;
  }
  return made;
}

/** Allocates a new payment. Whatever is left over stays as credit. */
export async function allocatePayment(tx, { schoolId, payment, preferInvoiceId = null }) {
  return spend(tx, { schoolId, payment, amount: payment.amount, preferInvoiceId });
}

/**
 * Uses the learner's credit (unspent parts of earlier payments, oldest
 * first) on their unpaid invoices. Call after anything that creates or
 * raises an invoice, or frees money (void, reversal of a covering payment).
 */
export async function applyCredit(tx, { schoolId, studentId }) {
  const payments = await tx.feePayment.findMany({
    where: { schoolId, studentId, isReversed: false },
    orderBy: { receivedAt: "asc" },
  });
  const made = [];
  for (const p of payments) {
    const left = await unallocatedOf(tx, p);
    if (left > 0) made.push(...(await spend(tx, { schoolId, payment: p, amount: left })));
  }
  return made;
}

/** { owed, credit, net } for a learner: net > 0 owes the school, < 0 is in credit. */
export async function accountSummary(db, { schoolId, studentId }) {
  const [owedAgg, paidAgg, allocAgg] = await Promise.all([
    db.feeInvoice.aggregate({ where: { schoolId, studentId, status: { not: "VOID" } }, _sum: { balance: true } }),
    db.feePayment.aggregate({ where: { schoolId, studentId, isReversed: false }, _sum: { amount: true } }),
    db.feePaymentAllocation.aggregate({ where: { schoolId, payment: { studentId, isReversed: false } }, _sum: { amount: true } }),
  ]);
  const owed = Number(owedAgg._sum.balance || 0);
  const credit = Number(paidAgg._sum.amount || 0) - Number(allocAgg._sum.amount || 0);
  return { owed, credit, net: owed - credit };
}

/** Marks a payment reversed and recomputes every invoice it paid. */
export async function reversePayment(tx, { schoolId, paymentId, actorId, reason }) {
  const found = await tx.feePayment.findFirst({ where: { id: String(paymentId), schoolId }, select: { studentId: true } });
  if (!found) throw httpError(404, "Payment not found.");
  await lockStudent(tx, schoolId, found.studentId);
  // Re-read under the lock: a concurrent reversal will have committed by now.
  const payment = await tx.feePayment.findUnique({ where: { id: String(paymentId) }, include: { allocations: true } });
  if (payment.isReversed) throw httpError(400, "Payment already reversed.");

  const reversed = await tx.feePayment.update({
    where: { id: payment.id },
    data: { isReversed: true, reversedAt: new Date(), reversedBy: actorId || null, reversalReason: reason },
  });
  for (const invoiceId of new Set(payment.allocations.map((a) => a.invoiceId))) await recomputeInvoice(tx, invoiceId);
  // Credit from other payments covers what this one no longer does.
  await applyCredit(tx, { schoolId, studentId: payment.studentId });

  const invoice = payment.invoiceId ? await tx.feeInvoice.findUnique({ where: { id: payment.invoiceId } }) : null;
  return { payment: reversed, invoice };
}
