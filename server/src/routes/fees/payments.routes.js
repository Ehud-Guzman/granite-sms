// src/routes/fees/payments.routes.js
// Recording payments.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/subscription.js";
import { toInt, toNumber } from "../../utils/validate.js";
import { getSchoolCalendar, localDateString, localDayRange, isDateString } from "../../utils/schoolTime.js";
import { notifyPayment } from "../../modules/sms/notify.js";
import { lockInvoice, lockStudent, allocatePayment, accountSummary, nextDocumentNo } from "../../modules/fees/ledger.js";
import { ALLOWED_PAYMENT_METHODS, normalizePaymentMethod, MONEY_TX_OPTIONS, feesAudit, staffNames } from "./shared.js";

const router = Router();

/**
 * GET /api/fees/payments?page=1&pageSize=25&from=YYYY-MM-DD&to=YYYY-MM-DD&method=MPESA&q=
 * The payments ledger, newest first, a page at a time. `q` matches receipt
 * number, reference, learner name or admission number; from/to are days in
 * the school's time zone. Totals cover the whole filter (reversed payments
 * are counted separately, not in the amount).
 */
router.get("/payments", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const page = Math.max(toInt(req.query.page, 1) || 1, 1);
  const pageSize = Math.min(Math.max(toInt(req.query.pageSize, 25) || 25, 1), 200);
  const q = String(req.query.q || "").trim().slice(0, 80);
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const method = req.query.method ? normalizePaymentMethod(req.query.method) : null;
  if (req.query.method && !method) {
    return res.status(400).json({ message: `method must be one of: ${ALLOWED_PAYMENT_METHODS.join(", ")}.` });
  }
  if ((from && !isDateString(from)) || (to && !isDateString(to))) {
    return res.status(400).json({ message: "from and to must be dates (YYYY-MM-DD)." });
  }

  const { timezone } = await getSchoolCalendar(req.schoolId);
  let receivedAt;
  if (from || to) {
    const range = localDayRange(from || "2000-01-01", to || "2100-12-31", timezone);
    receivedAt = { gte: range.from, lte: range.to };
  }

  const where = {
    schoolId: req.schoolId,
    ...(receivedAt ? { receivedAt } : {}),
    ...(method ? { method } : {}),
    ...(q
      ? {
          OR: [
            { receiptNo: { contains: q, mode: "insensitive" } },
            { reference: { contains: q, mode: "insensitive" } },
            { student: { admissionNo: { contains: q, mode: "insensitive" } } },
            { student: { firstName: { contains: q, mode: "insensitive" } } },
            { student: { lastName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [items, total, live, byMethod, reversed] = await Promise.all([
    prisma.feePayment.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        receiptNo: true,
        amount: true,
        method: true,
        reference: true,
        receivedAt: true,
        receivedBy: true,
        isReversed: true,
        student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, class: { select: { name: true, stream: true } } } },
      },
    }),
    prisma.feePayment.count({ where }),
    prisma.feePayment.aggregate({ where: { ...where, isReversed: false }, _sum: { amount: true }, _count: true }),
    prisma.feePayment.groupBy({ by: ["method"], where: { ...where, isReversed: false }, _sum: { amount: true }, _count: true }),
    prisma.feePayment.count({ where: { ...where, isReversed: true } }),
  ]);

  // Money in per day (per month when the filter spans more than ~3 months),
  // in the school's time zone, for the chart. Reversed payments don't count.
  const amounts = await prisma.feePayment.findMany({
    where: { ...where, isReversed: false },
    select: { receivedAt: true, amount: true },
    orderBy: { receivedAt: "asc" },
    take: 50000,
  });
  const firstDay = amounts.length ? localDateString(amounts[0].receivedAt, timezone) : null;
  const lastDay = amounts.length ? localDateString(amounts[amounts.length - 1].receivedAt, timezone) : null;
  const spanDays = firstDay ? (Date.parse(lastDay) - Date.parse(firstDay)) / 86400000 : 0;
  const bucket = spanDays > 92 ? "month" : "day";
  const sums = new Map();
  for (const a of amounts) {
    const d = localDateString(a.receivedAt, timezone);
    const k = bucket === "month" ? d.slice(0, 7) : d;
    sums.set(k, (sums.get(k) || 0) + a.amount);
  }
  // Every day (or month) in the span, so quiet days show as zero, not as a gap.
  const series = [];
  if (firstDay) {
    if (bucket === "day") {
      for (let t = Date.parse(firstDay); t <= Date.parse(lastDay); t += 86400000) {
        const k = new Date(t).toISOString().slice(0, 10);
        series.push({ period: k, amount: sums.get(k) || 0 });
      }
    } else {
      let [y, m] = firstDay.slice(0, 7).split("-").map(Number);
      const end = lastDay.slice(0, 7);
      for (;;) {
        const k = `${y}-${String(m).padStart(2, "0")}`;
        series.push({ period: k, amount: sums.get(k) || 0 });
        if (k >= end) break;
        m += 1;
        if (m > 12) (m = 1), (y += 1);
      }
    }
  }

  const names = await staffNames(req.schoolId, items.map((p) => p.receivedBy));
  return res.json({
    items: items.map((p) => ({ ...p, receivedByName: names.get(String(p.receivedBy)) || null })),
    total,
    page,
    pageSize,
    totals: {
      amount: live._sum.amount || 0,
      count: live._count || 0,
      reversed,
      byMethod: byMethod
        .map((m) => ({ method: m.method, amount: m._sum.amount || 0, count: m._count }))
        .sort((a, b) => b.amount - a.amount),
      bucket,
      series,
    },
  });
});

/* --------------------
 * Payments
 * --------------------
 * - ADMIN and BURSAR can post payments (cashier role)
 * - Entitlement controls whether the school tier allows it
 */

router.post(
  "/payments",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { invoiceId, studentId: bodyStudentId, amount, method = "CASH", reference, clientTxnId } = req.body || {};

      // Pay against an invoice, or straight onto a learner's account (e.g.
      // fees paid before the term's invoices exist).
      if ((!invoiceId && !bodyStudentId) || amount === undefined || amount === null) {
        return res.status(400).json({ message: "amount and either invoiceId or studentId are required." });
      }

      const amt = toNumber(amount, null);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ message: "amount must be > 0." });
      }
      if (!Number.isInteger(amt)) {
        return res.status(400).json({ message: "amount must be a whole number." });
      }

      const normalizedMethod = normalizePaymentMethod(method);
      if (!normalizedMethod) {
        return res.status(400).json({
          message: `Invalid payment method. Allowed: ${ALLOWED_PAYMENT_METHODS.join(", ")}`,
        });
      }

      // Read before the transaction: inside it every query must use tx, or it
      // needs a second pooled connection while this one waits on the lock.
      const { timezone } = await getSchoolCalendar(req.schoolId);

      const result = await prisma.$transaction(async (tx) => {
        const txnId = clientTxnId ? String(clientTxnId) : null;

        // Lock the learner's account first: everything below sees it after
        // any payment/reversal already in flight has committed.
        let invoice = null;
        let studentId = bodyStudentId ? String(bodyStudentId) : null;
        if (invoiceId) {
          invoice = await lockInvoice(tx, req.schoolId, invoiceId);
          if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
          if (studentId && studentId !== invoice.studentId) {
            throw Object.assign(new Error("That invoice belongs to a different learner."), { status: 400 });
          }
          studentId = invoice.studentId;
        } else if (!(await lockStudent(tx, req.schoolId, studentId))) {
          throw Object.assign(new Error("Student not found."), { status: 404 });
        }

        // Idempotency (checked under the lock, so a double-submit waits for
        // the first request and then returns its payment).
        if (txnId) {
          const existing = await tx.feePayment.findFirst({
            where: { schoolId: req.schoolId, clientTxnId: txnId },
            include: { invoice: true },
          });
          if (existing) {
            const account = await accountSummary(tx, { schoolId: req.schoolId, studentId: existing.studentId });
            return { payment: existing, invoice: existing.invoice, allocations: [], account, idempotent: true };
          }
        }

        if (invoice?.status === "VOID") {
          throw Object.assign(new Error("Cannot pay a VOID invoice."), { status: 400 });
        }

        const payment = await tx.feePayment.create({
          data: {
            schoolId: req.schoolId,
            studentId,
            invoiceId: invoice?.id || null,
            clientTxnId: txnId,
            amount: amt,
            method: normalizedMethod,
            reference: reference ? String(reference) : null,
            receivedBy: req.user?.id || null,
            receiptNo: await nextDocumentNo(tx, {
              schoolId: req.schoolId,
              kind: "RECEIPT",
              year: Number(localDateString(new Date(), timezone).slice(0, 4)),
              prefix: "RCPT",
            }),
            receivedAt: new Date(),
            receiptIssuedAt: new Date(),
          },
        });

        // The chosen invoice first, then the oldest unpaid ones; any excess
        // stays on the account as credit (audit M5: overpayment used to be refused).
        const allocations = await allocatePayment(tx, { schoolId: req.schoolId, payment, preferInvoiceId: invoice?.id || null });
        const updatedInvoice = invoice ? await tx.feeInvoice.findUnique({ where: { id: invoice.id } }) : null;
        const account = await accountSummary(tx, { schoolId: req.schoolId, studentId });

        return { payment, invoice: updatedInvoice, allocations, account, idempotent: false };
      }, MONEY_TX_OPTIONS);

      await feesAudit(req, {
        action: result.idempotent ? "FEES_PAYMENT_IDEMPOTENT" : "FEES_PAYMENT_POSTED",
        targetType: "FEE_PAYMENT",
        targetId: result.payment.id,
        metadata: {
          amount: result.payment.amount,
          method: result.payment.method,
          invoiceId: result.payment.invoiceId,
          studentId: result.payment.studentId,
          allocations: result.allocations,
          creditAfter: result.account.credit,
        },
      });
      // Receipt SMS to the parent, if the school has it on (never blocks the payment).
      if (!result.idempotent) notifyPayment({ schoolId: req.schoolId, paymentId: result.payment.id, actorId: req.user?.id });

      return res.status(201).json(result);
    } catch (err) {
      console.error("PAYMENT ERROR:", err);

      if (err?.code === "P2003")
        return res.status(400).json({ message: "Bad foreign key (invoiceId?)" });
      if (err?.code === "P2002")
        return res.status(409).json({ message: "Duplicate payment key. Retry." });

      return res.status(err?.status || 500).json({ message: err?.message || "Server error" });
    }
  }
);

export default router;
