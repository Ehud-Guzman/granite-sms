// src/routes/fees/invoices.routes.js
// Invoices: list, view, generate, void, extra lines, discounts.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/subscription.js";
import { toInt, toNumber } from "../../utils/validate.js";
import { computeInvoiceStatus, lockInvoice, recomputeInvoice, applyCredit, accountSummary } from "../../modules/fees/ledger.js";
import { MONEY_TX_OPTIONS, planMismatch, createInvoice, feesAudit } from "./shared.js";

const router = Router();

/* --------------------
 * Invoices
 * --------------------
 * READ: ADMIN, BURSAR
 * WRITE (generate/void): ADMIN only
 */

/**
 * GET /api/fees/invoices
 * With ?page=N (1-based): one page of lightweight rows plus totals for the
 * whole filter — { items, total, page, pageSize, totals }. Searches student
 * name, admission number and invoice number with ?q=. (Audit H10: the list
 * used to return every invoice with lines and payments: 8.8 MB at 6,300.)
 * Without ?page: the old array form, capped, for per-student lookups.
 */
router.get("/invoices", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const studentId = req.query?.studentId ? String(req.query.studentId) : null;
  const classId = req.query?.classId ? String(req.query.classId) : null;
  const year = toInt(req.query?.year, null);
  const term = req.query?.term ? String(req.query.term) : null;
  const status = req.query?.status ? String(req.query.status) : null;
  const q = String(req.query?.q || "").trim().slice(0, 80);

  const where = {
    schoolId: req.schoolId,
    studentId: studentId || undefined,
    classId: classId || undefined,
    year: year ?? undefined,
    term: term || undefined,
    status: status || undefined,
    ...(q
      ? {
          OR: [
            { invoiceNo: { contains: q, mode: "insensitive" } },
            { student: { admissionNo: { contains: q, mode: "insensitive" } } },
            { student: { firstName: { contains: q, mode: "insensitive" } } },
            { student: { lastName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  if (req.query?.page !== undefined) {
    const page = Math.max(toInt(req.query.page, 1) || 1, 1);
    const pageSize = Math.min(Math.max(toInt(req.query.pageSize, 50) || 50, 1), 200);
    const [items, total, agg] = await Promise.all([
      prisma.feeInvoice.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          invoiceNo: true,
          year: true,
          term: true,
          status: true,
          total: true,
          discount: true,
          paid: true,
          balance: true,
          createdAt: true,
          classId: true,
          student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
        },
      }),
      prisma.feeInvoice.count({ where }),
      prisma.feeInvoice.aggregate({
        where: { ...where, status: where.status || { not: "VOID" } },
        _sum: { total: true, discount: true, paid: true, balance: true },
      }),
    ]);
    return res.json({
      items,
      total,
      page,
      pageSize,
      totals: {
        billed: agg._sum.total || 0,
        discount: agg._sum.discount || 0,
        paid: agg._sum.paid || 0,
        balance: agg._sum.balance || 0,
      },
    });
  }

  const invoices = await prisma.feeInvoice.findMany({
    where,
    take: 500,
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
    orderBy: { createdAt: "desc" },
  });

  return res.json(invoices);
});

router.get("/invoices/:id", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const { id } = req.params;

  const invoice = await prisma.feeInvoice.findFirst({
    where: { id: String(id), schoolId: req.schoolId },
    include: {
      lines: { include: { feeItem: { select: { name: true } } } },
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
  });

  if (!invoice) return res.status(404).json({ message: "Invoice not found." });

  // Every payment that paid this invoice (a payment may have been taken
  // against another invoice and overflowed here, or come from credit).
  const allocations = await prisma.feePaymentAllocation.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { createdAt: "asc" },
    select: {
      amount: true,
      createdAt: true,
      payment: { select: { id: true, receiptNo: true, method: true, receivedAt: true, isReversed: true } },
    },
  });
  // Unpaid balances from this learner's other (earlier or later) invoices.
  const others = await prisma.feeInvoice.aggregate({
    where: { schoolId: req.schoolId, studentId: invoice.studentId, id: { not: invoice.id }, status: { not: "VOID" } },
    _sum: { balance: true },
  });
  const account = await accountSummary(prisma, { schoolId: req.schoolId, studentId: invoice.studentId });
  return res.json({ ...invoice, allocations, arrears: Number(others._sum.balance || 0), account });
});

router.post(
  "/invoices/generate",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { studentId, classId, year, term, feePlanId } = req.body || {};
    const y = toInt(year, null);

    if (!studentId || !classId || !y || !term || !feePlanId) {
      return res.status(400).json({
        message: "studentId, classId, year, term, feePlanId are required.",
      });
    }

    const [studentRow, classRow] = await Promise.all([
      prisma.student.findFirst({
        where: { id: String(studentId), schoolId: req.schoolId },
        select: { id: true, classId: true, isActive: true },
      }),
      prisma.class.findFirst({
        where: { id: String(classId), schoolId: req.schoolId },
        select: { id: true },
      }),
    ]);

    if (!studentRow) return res.status(400).json({ message: "Invalid studentId" });
    if (!classRow) return res.status(400).json({ message: "Invalid classId" });

    const plan = await prisma.feePlan.findFirst({
      where: { id: String(feePlanId), schoolId: req.schoolId },
      include: { items: true },
    });
    if (!plan) return res.status(404).json({ message: "Fee plan not found." });

    const mismatch = planMismatch(plan, { classId, year: y, term });
    if (mismatch) return res.status(400).json({ message: mismatch });
    if (!studentRow.isActive) return res.status(400).json({ message: "This student is inactive." });
    if (studentRow.classId !== plan.classId) {
      return res.status(400).json({ message: "This student is not in the fee plan's class." });
    }

    try {
      const invoice = await createInvoice({
        schoolId: req.schoolId,
        studentId,
        classId: plan.classId,
        year: plan.year,
        term: plan.term,
        plan,
      });

      await feesAudit(req, {
        action: "FEES_INVOICE_GENERATED",
        targetType: "FEE_INVOICE",
        targetId: invoice.id,
        metadata: { studentId, classId, year: y, term, total: invoice.total },
      });

      return res.status(201).json({ ...invoice, payments: [] });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "Invoice already exists for that student/year/term.",
        });
      }
      console.error("GENERATE INVOICE ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/invoices/generate-bulk",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { classId, year, term, feePlanId } = req.body || {};
    const y = toInt(year, null);

    if (!classId || !y || !term || !feePlanId) {
      return res.status(400).json({
        message: "classId, year, term, feePlanId are required.",
      });
    }

    const classRow = await prisma.class.findFirst({
      where: { id: String(classId), schoolId: req.schoolId },
      select: { id: true },
    });
    if (!classRow) return res.status(400).json({ message: "Invalid classId" });

    const plan = await prisma.feePlan.findFirst({
      where: { id: String(feePlanId), schoolId: req.schoolId },
      include: { items: true },
    });
    if (!plan) return res.status(404).json({ message: "Fee plan not found." });

    const bulkMismatch = planMismatch(plan, { classId, year: y, term });
    if (bulkMismatch) return res.status(400).json({ message: bulkMismatch });

    const students = await prisma.student.findMany({
      where: { schoolId: req.schoolId, classId: String(classId), isActive: true },
      select: { id: true, admissionNo: true, firstName: true, lastName: true },
    });

    if (!students.length) {
      return res.status(400).json({ message: "No active students found in this class." });
    }

    // Pre-check which students are already invoiced for this year/term so we can
    // skip them up front. NOTE: each invoice below is created via its own call
    // (not one shared $transaction) — on Postgres, a unique-constraint error
    // inside a shared interactive transaction aborts the whole transaction, so
    // "catch P2002 and keep looping" would silently break after the first skip.
    const existing = await prisma.feeInvoice.findMany({
      where: {
        schoolId: req.schoolId,
        studentId: { in: students.map((s) => s.id) },
        year: y,
        term: String(term),
      },
      select: { studentId: true },
    });
    const alreadyInvoiced = new Set(existing.map((e) => e.studentId));

    const created = [];
    const skipped = [];

    try {
      for (const student of students) {
        if (alreadyInvoiced.has(student.id)) {
          skipped.push({
            studentId: student.id,
            admissionNo: student.admissionNo,
            reason: "Invoice already exists for that student/year/term.",
          });
          continue;
        }

        try {
          const invoice = await createInvoice({
            schoolId: req.schoolId,
            studentId: student.id,
            classId,
            year: y,
            term,
            plan,
          });
          created.push({
            studentId: student.id,
            admissionNo: student.admissionNo,
            invoiceId: invoice.id,
            total: invoice.total,
          });
        } catch (err) {
          if (err?.code === "P2002") {
            skipped.push({
              studentId: student.id,
              admissionNo: student.admissionNo,
              reason: "Invoice already exists for that student/year/term.",
            });
            continue;
          }
          throw err;
        }
      }

      await feesAudit(req, {
        action: "FEES_INVOICES_BULK_GENERATED",
        targetType: "CLASS",
        targetId: classId,
        metadata: {
          classId: String(classId),
          year: y,
          term: String(term),
          feePlanId: String(feePlanId),
          createdCount: created.length,
          skippedCount: skipped.length,
        },
      });

      return res.status(201).json({
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      });
    } catch (err) {
      console.error("BULK GENERATE INVOICE ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/invoices/:id/void",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();

      if (!reason) return res.status(400).json({ message: "Void reason is required." });

      let released = 0;
      const result = await prisma.$transaction(async (tx) => {
        const invoice = await lockInvoice(tx, req.schoolId, id);
        if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
        if (invoice.status === "VOID") throw Object.assign(new Error("Invoice is already void."), { status: 400 });

        // Money paid on it goes back to the learner's credit (and from there
        // to their other unpaid invoices) instead of blocking the void.
        const live = await tx.feePaymentAllocation.findMany({
          where: { invoiceId: invoice.id, payment: { isReversed: false } },
          select: { id: true, amount: true },
        });
        released = live.reduce((sum, x) => sum + x.amount, 0);
        if (live.length) await tx.feePaymentAllocation.deleteMany({ where: { id: { in: live.map((x) => x.id) } } });

        const updated = await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: { status: "VOID", voidedAt: new Date(), voidedBy: req.user?.id || null, voidReason: reason, paid: 0, balance: 0 },
        });
        await applyCredit(tx, { schoolId: req.schoolId, studentId: invoice.studentId });
        return updated;
      }, MONEY_TX_OPTIONS);

      await feesAudit(req, {
        action: "FEES_INVOICE_VOIDED",
        targetType: "FEE_INVOICE",
        targetId: id,
        metadata: { reason, releasedToCredit: released },
      });

      return res.json({ message: "Invoice voided successfully.", invoice: result });
    } catch (err) {
      console.error("VOID INVOICE ERROR:", err);
      return res.status(err?.status || 500).json({ message: err?.message || "Server error" });
    }
  }
);

/**
 * POST /api/fees/invoices/:id/lines  (ADMIN)
 * Adds a charge to an existing invoice mid-term (trip, uniform, exam fee):
 * { feeItemId, amount, note? }. The same fee item again adds to its line.
 * Credit on the account is used on the new amount.
 */
router.post(
  "/invoices/:id/lines",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const amt = toNumber(req.body?.amount, null);
      if (!Number.isInteger(amt) || amt <= 0) return res.status(400).json({ message: "amount must be a whole number above 0." });
      const feeItemId = String(req.body?.feeItemId || "");
      const note = req.body?.note ? String(req.body.note).trim().slice(0, 120) : null;

      const result = await prisma.$transaction(async (tx) => {
        const invoice = await lockInvoice(tx, req.schoolId, req.params.id);
        if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
        if (invoice.status === "VOID") throw Object.assign(new Error("Cannot add to a VOID invoice."), { status: 400 });
        const item = await tx.feeItem.findFirst({ where: { id: feeItemId, schoolId: req.schoolId, isActive: true } });
        if (!item) throw Object.assign(new Error("Unknown or inactive fee item."), { status: 400 });

        const existing = await tx.feeInvoiceLine.findUnique({ where: { invoiceId_feeItemId: { invoiceId: invoice.id, feeItemId } } });
        if (existing) {
          await tx.feeInvoiceLine.update({
            where: { id: existing.id },
            data: { amount: existing.amount + amt, note: [existing.note, note].filter(Boolean).join("; ") || null },
          });
        } else {
          await tx.feeInvoiceLine.create({ data: { invoiceId: invoice.id, feeItemId, amount: amt, note } });
        }
        await tx.feeInvoice.update({ where: { id: invoice.id }, data: { total: invoice.total + amt } });
        await recomputeInvoice(tx, invoice.id);
        await applyCredit(tx, { schoolId: req.schoolId, studentId: invoice.studentId });
        return tx.feeInvoice.findUnique({ where: { id: invoice.id }, include: { lines: true } });
      }, MONEY_TX_OPTIONS);

      await feesAudit(req, {
        action: "FEES_INVOICE_CHARGE_ADDED",
        targetType: "FEE_INVOICE",
        targetId: req.params.id,
        metadata: { feeItemId, amount: amt, note, newTotal: result.total },
      });
      return res.status(201).json({ invoice: result });
    } catch (err) {
      if (!err?.status) console.error("ADD CHARGE ERROR:", err);
      return res.status(err?.status || 500).json({ message: err?.status ? err.message : "Server error" });
    }
  }
);

/**
 * Sets the invoice's discount to an absolute amount (not additive) — e.g. a
 * bursary or sibling waiver. Balance/status are recomputed against
 * (total - discount). Reapplying with a new amount replaces the prior one.
 */
router.post(
  "/invoices/:id/discount",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();
      const amt = toNumber(req.body?.amount, null);

      if (!reason) return res.status(400).json({ message: "Discount reason is required." });
      if (!Number.isFinite(amt) || amt < 0) {
        return res.status(400).json({ message: "amount must be a number >= 0." });
      }
      if (!Number.isInteger(amt)) {
        return res.status(400).json({ message: "amount must be a whole number." });
      }

      const result = await prisma.$transaction(async (tx) => {
        const invoice = await lockInvoice(tx, req.schoolId, id);
        if (!invoice) {
          const e = new Error("Invoice not found.");
          e.status = 404;
          throw e;
        }

        if (invoice.status === "VOID") {
          const e = new Error("Cannot discount a VOID invoice.");
          e.status = 400;
          throw e;
        }

        const maxDiscount = Math.max(Number(invoice.total || 0) - Number(invoice.paid || 0), 0);
        if (amt > maxDiscount) {
          const e = new Error(
            `Discount cannot exceed ${maxDiscount} (total minus amount already paid).`
          );
          e.status = 400;
          throw e;
        }

        const { balance: newBalance, status: newStatus } = computeInvoiceStatus(
          invoice.total,
          invoice.paid,
          amt
        );

        return tx.feeInvoice.update({
          where: { id: invoice.id },
          data: {
            discount: amt,
            discountReason: reason,
            discountedBy: req.user?.id || null,
            discountedAt: new Date(),
            balance: newBalance,
            status: newStatus,
          },
        });
      });

      await feesAudit(req, {
        action: "FEES_INVOICE_DISCOUNTED",
        targetType: "FEE_INVOICE",
        targetId: id,
        metadata: { amount: amt, reason },
      });

      return res.json({ message: "Discount applied successfully.", invoice: result });
    } catch (err) {
      console.error("DISCOUNT INVOICE ERROR:", err);
      return res.status(err?.status || 500).json({ message: err?.message || "Server error" });
    }
  }
);

export default router;
