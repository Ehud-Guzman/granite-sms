// src/routes/fees/payments.routes.js
// Recording payments.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/subscription.js";
import { toNumber } from "../../utils/validate.js";
import { getSchoolCalendar, localDateString } from "../../utils/schoolTime.js";
import { notifyPayment } from "../../modules/sms/notify.js";
import { lockInvoice, lockStudent, allocatePayment, accountSummary, nextDocumentNo } from "../../modules/fees/ledger.js";
import { ALLOWED_PAYMENT_METHODS, normalizePaymentMethod, MONEY_TX_OPTIONS, feesAudit } from "./shared.js";

const router = Router();

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
