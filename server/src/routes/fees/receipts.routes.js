// src/routes/fees/receipts.routes.js
// Receipts (HTML data and PDF).
import { Router } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { accountSummary } from "../../modules/fees/ledger.js";
import { staffNames, feesAudit } from "./shared.js";

const router = Router();


/**
 * Receipts:
 * - BURSAR should be able to view/print receipts they issue
 */
router.get("/payments/:id/receipt", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await prisma.feePayment.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
      include: { invoice: true },
    });

    if (!payment) return res.status(404).json({ message: "Payment not found." });

    const student = await prisma.student.findFirst({
      where: { id: payment.studentId, schoolId: req.schoolId },
      select: { id: true, admissionNo: true, firstName: true, lastName: true, classId: true },
    });

    await feesAudit(req, {
      action: "FEES_RECEIPT_VIEWED",
      targetType: "FEE_PAYMENT",
      targetId: id,
    });
    const names = await staffNames(req.schoolId, [payment.receivedBy]);
    const account = await accountSummary(prisma, { schoolId: req.schoolId, studentId: payment.studentId });

    return res.json({
      receiptNo: payment.receiptNo,
      account,
      receiptIssuedAt: payment.receiptIssuedAt,
      isReversed: payment.isReversed,
      reversedAt: payment.reversedAt,
      reversalReason: payment.reversalReason,
      payment: {
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        receivedAt: payment.receivedAt,
        receivedBy: payment.receivedBy,
        receivedByName: names.get(String(payment.receivedBy)) || null,
      },
      // null when the money went straight onto the account.
      invoice: payment.invoice && {
        id: payment.invoice.id,
        year: payment.invoice.year,
        term: payment.invoice.term,
        total: payment.invoice.total,
        discount: payment.invoice.discount,
        paid: payment.invoice.paid,
        balance: payment.invoice.balance,
        status: payment.invoice.status,
      },
      student,
      schoolId: req.schoolId,
    });
  } catch (err) {
    console.error("RECEIPT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/payments/:id/receipt.pdf", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await prisma.feePayment.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
      include: { invoice: true },
    });

    if (!payment) return res.status(404).json({ message: "Payment not found." });

    const student = await prisma.student.findFirst({
      where: { id: payment.studentId, schoolId: req.schoolId },
      select: { admissionNo: true, firstName: true, lastName: true },
    });

    await feesAudit(req, {
      action: "FEES_RECEIPT_PDF_VIEWED",
      targetType: "FEE_PAYMENT",
      targetId: id,
    });
    const pdfNames = await staffNames(req.schoolId, [payment.receivedBy]);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=receipt-${payment.receiptNo}.pdf`);
    doc.pipe(res);

    if (payment.isReversed) {
      doc.save();
      doc.rotate(-25, { origin: [100, 300] });
      doc.fontSize(60).fillColor("gray").opacity(0.25).text("REVERSED", 80, 250);
      doc.opacity(1).fillColor("black");
      doc.restore();
      doc.moveDown();
    }

    doc.fontSize(18).text("SCHOOL FEES RECEIPT", { align: "center" });
    doc.moveDown();

    const issuedAt = payment.receiptIssuedAt
      ? new Date(payment.receiptIssuedAt)
      : payment.receivedAt
      ? new Date(payment.receivedAt)
      : new Date();

    doc.fontSize(11);
    doc.text(`Receipt No: ${payment.receiptNo || "—"}`);
    doc.text(`Date: ${issuedAt.toDateString()}`);
    doc.text(`Status: ${payment.isReversed ? "REVERSED" : "POSTED"}`);
    if (payment.isReversed) {
      doc.text(
        `Reversed At: ${payment.reversedAt ? new Date(payment.reversedAt).toLocaleString() : "—"}`
      );
      doc.text(`Reason: ${payment.reversalReason || "—"}`);
    }
    doc.moveDown();

    doc.text(`Student: ${student?.firstName || "—"} ${student?.lastName || ""}`);
    doc.text(`Admission No: ${student?.admissionNo || "—"}`);
    doc.moveDown();

    doc.text(`Amount Paid: ${payment.amount}`);
    doc.text(`Payment Method: ${payment.method}`);
    if (payment.reference) doc.text(`Reference: ${payment.reference}`);
    doc.text(`Received By: ${pdfNames.get(String(payment.receivedBy)) || "—"}`);
    doc.moveDown();

    if (payment.invoice) {
      doc.text(`Invoice Total: ${payment.invoice.total}`);
      if (payment.invoice.discount) doc.text(`Discount: ${payment.invoice.discount}`);
      doc.text(`Total Paid: ${payment.invoice.paid}`);
      doc.text(`Balance: ${payment.invoice.balance}`);
    } else {
      doc.text("Paid onto the learner's account (credit).");
    }
    const acct = await accountSummary(prisma, { schoolId: req.schoolId, studentId: payment.studentId });
    doc.text(acct.net > 0 ? `Account balance due: ${acct.net}` : `Account credit: ${-acct.net}`);
    doc.moveDown();

    doc.text("Thank you.", { align: "center" });
    doc.end();
  } catch (err) {
    console.error("RECEIPT PDF ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
