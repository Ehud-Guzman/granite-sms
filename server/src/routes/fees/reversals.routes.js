// src/routes/fees/reversals.routes.js
// Payment reversals and reversal requests.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/subscription.js";
import { lockStudent } from "../../modules/fees/ledger.js";
import { MONEY_TX_OPTIONS, feesAudit, httpError, reversePaymentTx, sendFeesError } from "./shared.js";

const router = Router();

/* --------------------
 * Payment reversals
 * --------------------
 * ADMIN reverses directly. BURSAR (who handles the cash) can only *request*
 * a reversal; an ADMIN approves or rejects it. Audit finding H5: a bursar
 * reversing their own receipts is the classic way cash goes missing.
 */

router.post(
  "/payments/:id/reverse",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();
      if (!reason) return res.status(400).json({ message: "Reversal reason is required." });

      const result = await prisma.$transaction(
        (tx) => reversePaymentTx(tx, { schoolId: req.schoolId, paymentId: id, actorId: req.user?.id, reason }),
        MONEY_TX_OPTIONS
      );

      await feesAudit(req, {
        action: "FEES_PAYMENT_REVERSED",
        targetType: "FEE_PAYMENT",
        targetId: id,
        metadata: { reason, amount: result.payment.amount, receiptNo: result.payment.receiptNo },
      });

      return res.json({ message: "Payment reversed successfully.", ...result });
    } catch (err) {
      return sendFeesError(res, err, "REVERSE PAYMENT ERROR");
    }
  }
);

const reversalRequestInclude = {
  payment: {
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      receiptNo: true,
      receivedAt: true,
      isReversed: true,
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          year: true,
          term: true,
          student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
        },
      },
    },
  },
};

// BURSAR or ADMIN: ask for a payment to be reversed.
router.post(
  "/payments/:id/reversal-requests",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();
      if (!reason) return res.status(400).json({ message: "Reversal reason is required." });

      const request = await prisma.$transaction(async (tx) => {
        const found = await tx.feePayment.findFirst({
          where: { id: String(id), schoolId: req.schoolId },
          select: { studentId: true },
        });
        if (!found) throw httpError(404, "Payment not found.");
        // Same lock as payments/reversals: serialises duplicate requests.
        await lockStudent(tx, req.schoolId, found.studentId);

        const payment = await tx.feePayment.findUnique({ where: { id: String(id) } });
        if (payment.isReversed) throw httpError(400, "Payment already reversed.");

        const open = await tx.feeReversalRequest.findFirst({
          where: { paymentId: payment.id, status: "PENDING" },
          select: { id: true },
        });
        if (open) throw httpError(409, "A reversal request for this payment is already waiting for approval.");

        return tx.feeReversalRequest.create({
          data: { schoolId: req.schoolId, paymentId: payment.id, reason, requestedBy: req.user.id },
          include: reversalRequestInclude,
        });
      }, MONEY_TX_OPTIONS);

      await feesAudit(req, {
        action: "FEES_REVERSAL_REQUESTED",
        targetType: "FEE_PAYMENT",
        targetId: id,
        metadata: { requestId: request.id, reason, amount: request.payment.amount, receiptNo: request.payment.receiptNo },
      });

      return res.status(201).json({ request });
    } catch (err) {
      return sendFeesError(res, err, "REVERSAL REQUEST ERROR");
    }
  }
);

// ADMIN sees all requests; BURSAR sees the ones they raised.
router.get("/reversal-requests", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  try {
    const status = String(req.query?.status || "PENDING").toUpperCase();
    if (!["PENDING", "APPROVED", "REJECTED", "ALL"].includes(status)) {
      return res.status(400).json({ message: "status must be PENDING, APPROVED, REJECTED or ALL." });
    }
    const requests = await prisma.feeReversalRequest.findMany({
      where: {
        schoolId: req.schoolId,
        ...(status === "ALL" ? {} : { status }),
        ...(req.role === "BURSAR" ? { requestedBy: req.user.id } : {}),
      },
      include: reversalRequestInclude,
      orderBy: { requestedAt: "desc" },
      take: 100,
    });

    // Names instead of user ids, for display.
    const userIds = [...new Set(requests.flatMap((r) => [r.requestedBy, r.decidedBy]).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, schoolId: req.schoolId },
          select: { id: true, email: true, teacher: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const nameOf = new Map(
      users.map((u) => [u.id, u.teacher ? `${u.teacher.firstName} ${u.teacher.lastName}`.trim() : u.email])
    );

    return res.json({
      requests: requests.map((r) => ({
        ...r,
        requestedByName: nameOf.get(r.requestedBy) || null,
        decidedByName: r.decidedBy ? nameOf.get(r.decidedBy) || null : null,
      })),
    });
  } catch (err) {
    return sendFeesError(res, err, "LIST REVERSAL REQUESTS ERROR");
  }
});

// ADMIN: approve (performs the reversal) or reject.
async function decideReversalRequest(req, res, decision) {
  try {
    const { id } = req.params;
    const note = String(req.body?.note || "").trim() || null;
    if (decision === "reject" && !note) {
      return res.status(400).json({ message: "Say why the request is rejected." });
    }

    const out = await prisma.$transaction(async (tx) => {
      const request = await tx.feeReversalRequest.findFirst({
        where: { id: String(id), schoolId: req.schoolId },
      });
      if (!request) throw httpError(404, "Reversal request not found.");

      const payment = await tx.feePayment.findUnique({
        where: { id: request.paymentId },
        select: { studentId: true },
      });
      await lockStudent(tx, req.schoolId, payment.studentId);

      // Re-read under the lock so two admins can't both decide it.
      const current = await tx.feeReversalRequest.findUnique({ where: { id: request.id } });
      if (current.status !== "PENDING") {
        throw httpError(409, `This request was already ${current.status.toLowerCase()}.`);
      }

      if (decision === "reject") {
        const rejected = await tx.feeReversalRequest.update({
          where: { id: request.id },
          data: { status: "REJECTED", decidedBy: req.user.id, decidedAt: new Date(), decisionNote: note },
        });
        return { request: rejected };
      }

      const reversal = await reversePaymentTx(tx, {
        schoolId: req.schoolId,
        paymentId: request.paymentId,
        actorId: req.user.id,
        reason: request.reason,
      });
      // reversePaymentTx settled pending requests as "Reversed directly"; record this decision properly.
      const approved = await tx.feeReversalRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", decidedBy: req.user.id, decidedAt: new Date(), decisionNote: note },
      });
      return { request: approved, ...reversal };
    }, MONEY_TX_OPTIONS);

    await feesAudit(req, {
      action: decision === "approve" ? "FEES_REVERSAL_APPROVED" : "FEES_REVERSAL_REJECTED",
      targetType: "FEE_PAYMENT",
      targetId: out.request.paymentId,
      metadata: { requestId: out.request.id, note, requestedBy: out.request.requestedBy },
    });
    if (decision === "approve") {
      await feesAudit(req, {
        action: "FEES_PAYMENT_REVERSED",
        targetType: "FEE_PAYMENT",
        targetId: out.request.paymentId,
        metadata: { reason: out.request.reason, viaRequest: out.request.id, amount: out.payment.amount },
      });
    }

    return res.json(out);
  } catch (err) {
    return sendFeesError(res, err, "DECIDE REVERSAL REQUEST ERROR");
  }
}

router.post("/reversal-requests/:id/approve", requireRole("ADMIN"), requireEntitlement("FEES_WRITE"), (req, res) =>
  decideReversalRequest(req, res, "approve")
);
router.post("/reversal-requests/:id/reject", requireRole("ADMIN"), requireEntitlement("FEES_WRITE"), (req, res) =>
  decideReversalRequest(req, res, "reject")
);

export default router;
