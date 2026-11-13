// src/routes/fees/statements.routes.js
// A learner's fee summary and statement.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { toInt } from "../../utils/validate.js";
import { isSelfService, canSeeOwnLearner } from "../../utils/learnerAccess.js";
import { accountSummary } from "../../modules/fees/ledger.js";

const router = Router();

/* --------------------
 * Student summary / statement
 * --------------------
 * - ADMIN and BURSAR can view any student in the tenant
 * - STUDENT can only view self (enforced)
 */

router.get(
  "/students/:studentId/summary",
  requireRole("ADMIN", "BURSAR", "STUDENT", "PARENT"),
  async (req, res) => {
    const { studentId } = req.params;
    const year = toInt(req.query?.year, null);
    const term = req.query?.term ? String(req.query.term) : null;

    // Learners see themselves; parents see their own children.
    if (isSelfService(req) && !(await canSeeOwnLearner(req, studentId))) {
      return res.status(403).json({ message: "You can only view your own fee summary." });
    }

    const student = await prisma.student.findFirst({
      where: { id: String(studentId), schoolId: req.schoolId },
      select: { id: true },
    });
    if (!student) return res.status(404).json({ message: "Student not found." });

    const invoices = await prisma.feeInvoice.findMany({
      where: {
        schoolId: req.schoolId,
        studentId: String(studentId),
        year: year ?? undefined,
        term: term || undefined,
        status: { not: "VOID" },
      },
      orderBy: { createdAt: "desc" },
    });

    const summary = invoices.reduce(
      (acc, inv) => {
        acc.total += Number(inv.total || 0);
        acc.discount += Number(inv.discount || 0);
        acc.paid += Number(inv.paid || 0);
        acc.balance += Number(inv.balance || 0);
        acc.count += 1;
        return acc;
      },
      { total: 0, discount: 0, paid: 0, balance: 0, count: 0 }
    );

    return res.json({
      studentId: String(studentId),
      year: year ?? null,
      term: term || null,
      ...summary,
      account: await accountSummary(prisma, { schoolId: req.schoolId, studentId: String(studentId) }),
      latestInvoice: invoices[0] || null,
    });
  }
);

router.get(
  "/students/:studentId/statement",
  requireRole("ADMIN", "BURSAR", "STUDENT", "PARENT"),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const year = toInt(req.query?.year, null);
      const term = req.query?.term ? String(req.query.term) : null;

      if (isSelfService(req) && !(await canSeeOwnLearner(req, studentId))) {
        return res.status(403).json({ message: "You can only view your own statement." });
      }

      const student = await prisma.student.findFirst({
        where: { id: String(studentId), schoolId: req.schoolId },
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          classId: true,
        },
      });

      if (!student) return res.status(404).json({ message: "Student not found." });

      const invoices = await prisma.feeInvoice.findMany({
        where: {
          schoolId: req.schoolId,
          studentId: String(studentId),
          year: year ?? undefined,
          term: term || undefined,
          status: { not: "VOID" },
        },
        include: {
          lines: true,
          payments: {
            orderBy: { receivedAt: "desc" },
            select: {
              id: true,
              amount: true,
              method: true,
              reference: true,
              receiptNo: true,
              receivedAt: true,
              isReversed: true,
              reversedAt: true,
              reversalReason: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const timeline = [];
      for (const inv of invoices) {
        timeline.push({
          type: "INVOICE",
          at: inv.createdAt,
          ref: inv.id,
          year: inv.year,
          term: inv.term,
          amount: inv.total,
          discount: inv.discount || 0,
          invoiceNo: inv.invoiceNo,
          status: inv.status,
        });

      }

      // Payments come from the learner's account, not each invoice: one payment
      // can cover several invoices, or none yet (credit). With a year/term
      // filter, only payments that paid that period's invoices are listed.
      const filtered = year != null || term;
      const payments = await prisma.feePayment.findMany({
        where: {
          schoolId: req.schoolId,
          studentId: String(studentId),
          isReversed: false,
          ...(filtered ? { allocations: { some: { invoice: { year: year ?? undefined, term: term || undefined } } } } : {}),
        },
        include: { allocations: { select: { invoiceId: true, amount: true, invoice: { select: { invoiceNo: true } } } } },
        orderBy: { receivedAt: "asc" },
      });
      for (const p of payments) {
        const allocated = p.allocations.reduce((sum, a) => sum + a.amount, 0);
        timeline.push({
          type: "PAYMENT",
          at: p.receivedAt,
          ref: p.id,
          receiptNo: p.receiptNo,
          method: p.method,
          reference: p.reference,
          amount: p.amount,
          appliedTo: p.allocations.map((a) => ({ invoiceNo: a.invoice?.invoiceNo || null, amount: a.amount })),
          toCredit: p.amount - allocated,
        });
      }

      timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
      const account = await accountSummary(prisma, { schoolId: req.schoolId, studentId: String(studentId) });

      const totals = invoices.reduce(
        (acc, inv) => {
          acc.totalBilled += Number(inv.total || 0);
          acc.totalDiscount += Number(inv.discount || 0);
          acc.totalPaid += Number(inv.paid || 0);
          acc.totalBalance += Number(inv.balance || 0);
          acc.invoiceCount += 1;
          return acc;
        },
        { totalBilled: 0, totalDiscount: 0, totalPaid: 0, totalBalance: 0, invoiceCount: 0 }
      );

      return res.json({
        student,
        filters: { year: year ?? null, term: term || null },
        totals,
        // Whole account, all terms: what is owed, and money held as credit.
        account,
        invoices,
        timeline,
      });
    } catch (err) {
      console.error("STATEMENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
