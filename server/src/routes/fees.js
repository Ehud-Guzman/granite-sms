// src/routes/fees.js
import { Router } from "express";
import PDFDocument from "pdfkit";

import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, requireEntitlement } from "../middleware/subscription.js";
import { logAudit } from "../utils/audit.js";
import { exportCSV, exportXLSX } from "../utils/export.js";


const router = Router();

/**
 * Assumptions:
 * - requireAuth + tenantContext already ran before hitting /api/fees
 * - requireTenant enforces tenant presence (req.schoolId)
 */
router.use(requireTenant);
router.use(loadSubscription);

/* --------------------------------------
 * Helpers
 * -------------------------------------- */

const ALLOWED_PAYMENT_METHODS = ["CASH", "MPESA", "BANK", "CHEQUE", "OTHER"];

function normalizePaymentMethod(method) {
  const m = String(method || "CASH").trim().toUpperCase();
  return ALLOWED_PAYMENT_METHODS.includes(m) ? m : null;
}

function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNumber(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeInvoiceStatus(total, paid) {
  const t = Math.max(Number(total) || 0, 0);
  const p = Math.max(Number(paid) || 0, 0);
  const balance = Math.max(t - p, 0);
  const status = balance === 0 ? "PAID" : p > 0 ? "PARTIALLY_PAID" : "ISSUED";
  return { balance, status };
}

function makeInvoiceNo() {
  const d = new Date();
  const y = d.getFullYear();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${y}-${rand}`;
}

function makeReceiptNo() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RCPT-${y}${m}${day}-${rand}`;
}

function normalizeExportType(v) {
  const x = String(v || "").trim().toLowerCase();
  if (x === "csv" || x === "xlsx") return x;
  return null;
}


/* ------------ Audit helpers ------------ */
function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || req.user?.role || null,
    actorEmail: req.user?.email || null,
  };
}

async function feesAudit(req, { schoolId, action, targetType, targetId, metadata }) {
  return logAudit({
    req,
    ...actorCtx(req),
    schoolId: schoolId ?? req.schoolId ?? null,
    action,
    targetType,
    targetId: targetId ? String(targetId) : null,
    metadata: metadata ?? null,
  });
}

/* --------------------------------------
 * Subscription gating for specific reports
 * -------------------------------------- */
function requireSubscriptionForReports(req, res, next) {
  if (!req.subscription) {
    return res.status(402).json({ message: "Subscription required.", mode: "READ_ONLY" });
  }
  return next();
}

/* --------------------------------------
 * Strong date-range parsing for reports
 * -------------------------------------- */
function parseDateRange(from, to) {
  if (!from || !to) {
    const e = new Error("from and to are required (YYYY-MM-DD).");
    e.status = 400;
    throw e;
  }

  const fromDate = new Date(`${String(from)}T00:00:00.000Z`);
  const toDate = new Date(`${String(to)}T23:59:59.999Z`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    const e = new Error("Invalid date format. Use YYYY-MM-DD.");
    e.status = 400;
    throw e;
  }

  if (fromDate > toDate) {
    const e = new Error("from must be less than or equal to to.");
    e.status = 400;
    throw e;
  }

  return { fromDate, toDate };
}

/* --------------------------------------
 * Subscription (demo/admin setup endpoints)
 * -------------------------------------- */

router.get("/subscription", async (req, res) => {
  return res.json({
    schoolId: req.schoolId,
    subscription: req.subscription,
    mode: req.subscription ? "SUBSCRIBED" : "READ_ONLY",
  });
});

// Keep as ADMIN for demo setup. Later move to SYSTEM_ADMIN control plane.
router.post("/subscription", requireRole("ADMIN"), async (req, res) => {
  try {
    const {
      schoolName,
      schoolCode,
      status = "ACTIVE",
      entitlements = { FEES_WRITE: true, FEES_READ: true },
      currentPeriodEnd,
    } = req.body || {};

    if (!schoolName || String(schoolName).trim().length < 2) {
      return res.status(400).json({ message: "schoolName is required (min 2 chars)." });
    }

    const school = await prisma.school.upsert({
      where: { id: req.schoolId },
      update: {
        name: String(schoolName).trim(),
        code: schoolCode ? String(schoolCode).trim() : undefined,
      },
      create: {
        id: req.schoolId,
        name: String(schoolName).trim(),
        code: schoolCode ? String(schoolCode).trim() : null,
        isActive: true,
      },
    });

    const sub = await prisma.subscription.create({
      data: {
        schoolId: school.id,
        status,
        entitlements,
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
      },
    });

    await feesAudit(req, {
      action: "SUBSCRIPTION_CREATED",
      targetType: "SUBSCRIPTION",
      targetId: sub.id,
      metadata: { status, entitlements },
    });

    return res.status(201).json({ school, subscription: sub });
  } catch (err) {
    console.error("CREATE SUBSCRIPTION ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* --------------------
 * Fee Items (ADMIN-only)
 * -------------------- */

router.get("/items", requireRole("ADMIN"), async (req, res) => {
  const items = await prisma.feeItem.findMany({
    where: { schoolId: req.schoolId },
    orderBy: { createdAt: "desc" },
  });
  return res.json(items);
});

router.post(
  "/items",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { name, code } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: "name is required (min 2 chars)" });
    }

    try {
      const item = await prisma.feeItem.create({
        data: {
          schoolId: req.schoolId,
          name: String(name).trim(),
          code: code ? String(code).trim() : null,
        },
      });

      await feesAudit(req, {
        action: "FEES_ITEM_CREATED",
        targetType: "FEE_ITEM",
        targetId: item.id,
        metadata: { name: item.name, code: item.code },
      });

      return res.status(201).json(item);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Fee item already exists." });
      }
      console.error("CREATE FEE ITEM ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.patch(
  "/items/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;
    const { name, code, isActive } = req.body || {};

    const existing = await prisma.feeItem.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee item not found." });

    try {
      const updated = await prisma.feeItem.update({
        where: { id: String(id) },
        data: {
          name: name !== undefined ? String(name).trim() : undefined,
          code: code !== undefined ? (code ? String(code).trim() : null) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
      });

      await feesAudit(req, {
        action: "FEES_ITEM_UPDATED",
        targetType: "FEE_ITEM",
        targetId: id,
        metadata: { before: existing, after: updated },
      });

      return res.json(updated);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Update conflict (duplicate name/code?)" });
      }
      console.error("UPDATE FEE ITEM ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/items/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;

    const existing = await prisma.feeItem.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee item not found." });

const updated = await prisma.feeItem.updateMany({
  where: { id: String(id), schoolId: req.schoolId },
  data: { isActive: false },
});

if (updated.count === 0) {
  return res.status(404).json({ message: "Fee item not found." });
}


    await feesAudit(req, {
      action: "FEES_ITEM_DEACTIVATED",
      targetType: "FEE_ITEM",
      targetId: id,
    });

    return res.json({ message: "Fee item deactivated." });
  }
);

/* --------------------
 * Fee Plans (ADMIN-only)
 * -------------------- */

router.get("/plans", requireRole("ADMIN"), async (req, res) => {
  const classId = req.query?.classId ? String(req.query.classId) : null;
  const year = toInt(req.query?.year, null);
  const term = req.query?.term ? String(req.query.term) : null;

  const plans = await prisma.feePlan.findMany({
    where: {
      schoolId: req.schoolId,
      classId: classId || undefined,
      year: year ?? undefined,
      term: term || undefined,
    },
    include: { items: { include: { feeItem: true } } },
    orderBy: { createdAt: "desc" },
  });

  return res.json(plans);
});

router.post(
  "/plans",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { classId, year, term, title, items } = req.body || {};

    const y = toInt(year, null);
    if (!classId || !y || !term) {
      return res.status(400).json({ message: "classId, year, term are required." });
    }
    if (!Array.isArray(items) || items.length < 1) {
      return res.status(400).json({ message: "items[] is required (min 1)." });
    }

    const classRow = await prisma.class.findFirst({
      where: { id: String(classId), schoolId: req.schoolId },
      select: { id: true },
    });
    if (!classRow) return res.status(400).json({ message: "Invalid classId" });

    const feeItemIds = items.map((it) => String(it.feeItemId));
    const validItems = await prisma.feeItem.findMany({
      where: { id: { in: feeItemIds }, schoolId: req.schoolId, isActive: true },
      select: { id: true },
    });
    const validSet = new Set(validItems.map((x) => x.id));
    const bad = feeItemIds.filter((id) => !validSet.has(id));
    if (bad.length) {
      return res.status(400).json({ message: `Invalid feeItemId(s): ${bad.join(", ")}` });
    }

    try {
      const plan = await prisma.feePlan.create({
        data: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          title: title ? String(title) : null,
          items: {
            create: items.map((it) => ({
              feeItemId: String(it.feeItemId),
              amount: Number(it.amount),
              required: it.required !== undefined ? Boolean(it.required) : true,
            })),
          },
        },
        include: { items: { include: { feeItem: true } } },
      });

      await feesAudit(req, {
        action: "FEES_PLAN_CREATED",
        targetType: "FEE_PLAN",
        targetId: plan.id,
        metadata: { classId, year: y, term, items: plan.items.length },
      });

      return res.status(201).json(plan);
    } catch (err) {
      console.error("CREATE PLAN ERROR:", err);
      return res.status(409).json({
        message: "Plan already exists for class/year/term OR invalid input.",
      });
    }
  }
);

/* --------------------
 * Invoices
 * --------------------
 * READ: ADMIN, BURSAR
 * WRITE (generate/void): ADMIN only
 */

router.get("/invoices", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const studentId = req.query?.studentId ? String(req.query.studentId) : null;
  const classId = req.query?.classId ? String(req.query.classId) : null;
  const year = toInt(req.query?.year, null);
  const term = req.query?.term ? String(req.query.term) : null;
  const status = req.query?.status ? String(req.query.status) : null;

  const invoices = await prisma.feeInvoice.findMany({
    where: {
      schoolId: req.schoolId,
      studentId: studentId || undefined,
      classId: classId || undefined,
      year: year ?? undefined,
      term: term || undefined,
      status: status || undefined,
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
    orderBy: { createdAt: "desc" },
  });

  return res.json(invoices);
});

router.get("/invoices/:id", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const { id } = req.params;

  const invoice = await prisma.feeInvoice.findFirst({
    where: { id: String(id), schoolId: req.schoolId },
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
  });

  if (!invoice) return res.status(404).json({ message: "Invoice not found." });
  return res.json(invoice);
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
        select: { id: true },
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

    const total = (plan.items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

    try {
      const invoice = await prisma.feeInvoice.create({
        data: {
          schoolId: req.schoolId,
          studentId: String(studentId),
          classId: String(classId),
          year: y,
          term: String(term),
          invoiceNo: makeInvoiceNo(), // ok if your schema has it; ignored if not mapped
          status: "ISSUED",
          total,
          paid: 0,
          balance: total,
          lines: {
            create: plan.items.map((it) => ({
              feeItemId: it.feeItemId,
              amount: it.amount,
            })),
          },
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
      });

      await feesAudit(req, {
        action: "FEES_INVOICE_GENERATED",
        targetType: "FEE_INVOICE",
        targetId: invoice.id,
        metadata: { studentId, classId, year: y, term, total },
      });

      return res.status(201).json(invoice);
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
  "/invoices/:id/void",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();

      if (!reason) return res.status(400).json({ message: "Void reason is required." });

      const result = await prisma.$transaction(async (tx) => {
        const invoice = await tx.feeInvoice.findFirst({
          where: { id: String(id), schoolId: req.schoolId },
          include: { payments: true },
        });

        if (!invoice) {
          const e = new Error("Invoice not found.");
          e.status = 404;
          throw e;
        }

        const activePayments = (invoice.payments || []).filter((p) => !p.isReversed);
        if (activePayments.length > 0) {
          const e = new Error("Cannot void invoice with active payments. Reverse payments first.");
          e.status = 400;
          throw e;
        }

        const updated = await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: {
            status: "VOID",
            voidedAt: new Date(),
            voidedBy: req.user?.id || null,
            voidReason: reason,
            balance: 0,
          },
        });

        return updated;
      });

      await feesAudit(req, {
        action: "FEES_INVOICE_VOIDED",
        targetType: "FEE_INVOICE",
        targetId: id,
        metadata: { reason },
      });

      return res.json({ message: "Invoice voided successfully.", invoice: result });
    } catch (err) {
      console.error("VOID INVOICE ERROR:", err);
      return res.status(err?.status || 500).json({ message: err?.message || "Server error" });
    }
  }
);

/* --------------------
 * Student summary / statement
 * --------------------
 * - ADMIN and BURSAR can view any student in the tenant
 * - STUDENT can only view self (enforced)
 */

router.get(
  "/students/:studentId/summary",
  requireRole("ADMIN", "BURSAR", "STUDENT"),
  async (req, res) => {
    const { studentId } = req.params;
    const year = toInt(req.query?.year, null);
    const term = req.query?.term ? String(req.query.term) : null;

    if (req.role === "STUDENT") {
      const me = await prisma.student.findFirst({
        where: { userId: req.user.id, schoolId: req.schoolId },
        select: { id: true },
      });
      if (!me || me.id !== String(studentId)) {
        return res.status(403).json({ message: "Students can only view their own fee summary." });
      }
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
        acc.paid += Number(inv.paid || 0);
        acc.balance += Number(inv.balance || 0);
        acc.count += 1;
        return acc;
      },
      { total: 0, paid: 0, balance: 0, count: 0 }
    );

    await feesAudit(req, {
      action: "FEES_SUMMARY_VIEWED",
      targetType: "STUDENT",
      targetId: studentId,
      metadata: { year: year ?? null, term: term || null },
    });

    return res.json({
      studentId: String(studentId),
      year: year ?? null,
      term: term || null,
      ...summary,
      latestInvoice: invoices[0] || null,
    });
  }
);

router.get(
  "/students/:studentId/statement",
  requireRole("ADMIN", "BURSAR", "STUDENT"),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const year = toInt(req.query?.year, null);
      const term = req.query?.term ? String(req.query.term) : null;

      if (req.role === "STUDENT") {
        const me = await prisma.student.findFirst({
          where: { userId: req.user.id, schoolId: req.schoolId },
          select: { id: true },
        });

        if (!me || me.id !== String(studentId)) {
          return res.status(403).json({ message: "Students can only view their own statement." });
        }
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
          status: inv.status,
        });

        for (const p of (inv.payments || []).filter((x) => !x.isReversed)) {
          timeline.push({
            type: "PAYMENT",
            at: p.receivedAt,
            ref: p.id,
            receiptNo: p.receiptNo,
            method: p.method,
            reference: p.reference,
            amount: p.amount,
          });
        }
      }

      timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

      const totals = invoices.reduce(
        (acc, inv) => {
          acc.totalBilled += Number(inv.total || 0);
          acc.totalPaid += Number(inv.paid || 0);
          acc.totalBalance += Number(inv.balance || 0);
          acc.invoiceCount += 1;
          return acc;
        },
        { totalBilled: 0, totalPaid: 0, totalBalance: 0, invoiceCount: 0 }
      );

      await feesAudit(req, {
        action: "FEES_STATEMENT_VIEWED",
        targetType: "STUDENT",
        targetId: studentId,
        metadata: { year: year ?? null, term: term || null },
      });

      return res.json({
        student,
        filters: { year: year ?? null, term: term || null },
        totals,
        invoices,
        timeline,
      });
    } catch (err) {
      console.error("STATEMENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

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
      const { invoiceId, amount, method = "CASH", reference, clientTxnId } = req.body || {};

      if (!invoiceId || amount === undefined || amount === null) {
        return res.status(400).json({ message: "invoiceId and amount are required." });
      }

      const amt = toNumber(amount, null);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ message: "amount must be > 0." });
      }

      const normalizedMethod = normalizePaymentMethod(method);
      if (!normalizedMethod) {
        return res.status(400).json({
          message: `Invalid payment method. Allowed: ${ALLOWED_PAYMENT_METHODS.join(", ")}`,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const txnId = clientTxnId ? String(clientTxnId) : null;

        // Idempotency
        if (txnId) {
          const existing = await tx.feePayment.findFirst({
            where: { schoolId: req.schoolId, clientTxnId: txnId },
            include: { invoice: true },
          });
          if (existing) return { payment: existing, invoice: existing.invoice, idempotent: true };
        }

        const invoice = await tx.feeInvoice.findFirst({
          where: { id: String(invoiceId), schoolId: req.schoolId },
        });
        if (!invoice) {
          const e = new Error("Invoice not found.");
          e.status = 404;
          throw e;
        }

        if (invoice.status === "VOID") {
          const e = new Error("Cannot pay a VOID invoice.");
          e.status = 400;
          throw e;
        }

        if (amt > Number(invoice.balance || 0)) {
          const e = new Error(`Overpayment not allowed. Balance is ${invoice.balance}.`);
          e.status = 400;
          throw e;
        }

        const payment = await tx.feePayment.create({
          data: {
            schoolId: req.schoolId,
            invoiceId: invoice.id,
            clientTxnId: txnId,
            amount: amt,
            method: normalizedMethod,
            reference: reference ? String(reference) : null,
            receivedBy: req.user?.id || null,
            receiptNo: makeReceiptNo(),
            // keep both for compatibility
            receivedAt: new Date(),
            receiptIssuedAt: new Date(),
          },
        });

        const newPaid = Number(invoice.paid || 0) + amt;
        const { balance: newBalance, status: newStatus } = computeInvoiceStatus(invoice.total, newPaid);

        const updatedInvoice = await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: { paid: newPaid, balance: newBalance, status: newStatus },
        });

        return { payment, invoice: updatedInvoice, idempotent: false };
      });

      await feesAudit(req, {
        action: result.idempotent ? "FEES_PAYMENT_IDEMPOTENT" : "FEES_PAYMENT_POSTED",
        targetType: "FEE_PAYMENT",
        targetId: result.payment.id,
        metadata: {
          amount: result.payment.amount,
          method: result.payment.method,
          invoiceId: result.payment.invoiceId,
        },
      });

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

router.post(
  "/payments/:id/reverse",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();

      if (!reason) return res.status(400).json({ message: "Reversal reason is required." });

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.feePayment.findFirst({
          where: { id: String(id), schoolId: req.schoolId },
        });
        if (!payment) {
          const e = new Error("Payment not found.");
          e.status = 404;
          throw e;
        }

        if (payment.isReversed) {
          const e = new Error("Payment already reversed.");
          e.status = 400;
          throw e;
        }

        const invoice = await tx.feeInvoice.findFirst({
          where: { id: payment.invoiceId, schoolId: req.schoolId },
        });
        if (!invoice) {
          const e = new Error("Invoice not found for payment.");
          e.status = 404;
          throw e;
        }

        const newPaid = Math.max(Number(invoice.paid || 0) - Number(payment.amount || 0), 0);
        const { balance: newBalance, status: newStatus } = computeInvoiceStatus(invoice.total, newPaid);

        const reversedPayment = await tx.feePayment.update({
          where: { id: payment.id },
          data: {
            isReversed: true,
            reversedAt: new Date(),
            reversedBy: req.user?.id || null,
            reversalReason: reason,
          },
        });

        const updatedInvoice = await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: { paid: newPaid, balance: newBalance, status: newStatus },
        });

        return { payment: reversedPayment, invoice: updatedInvoice };
      });

      await feesAudit(req, {
        action: "FEES_PAYMENT_REVERSED",
        targetType: "FEE_PAYMENT",
        targetId: id,
        metadata: { reason },
      });

      return res.json({ message: "Payment reversed successfully.", ...result });
    } catch (err) {
      console.error("REVERSE PAYMENT ERROR:", err);
      return res.status(err?.status || 500).json({ message: err?.message || "Server error" });
    }
  }
);

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
      where: { id: payment.invoice.studentId, schoolId: req.schoolId },
      select: { id: true, admissionNo: true, firstName: true, lastName: true, classId: true },
    });

    await feesAudit(req, {
      action: "FEES_RECEIPT_VIEWED",
      targetType: "FEE_PAYMENT",
      targetId: id,
    });

    return res.json({
      receiptNo: payment.receiptNo,
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
      },
      invoice: {
        id: payment.invoice.id,
        year: payment.invoice.year,
        term: payment.invoice.term,
        total: payment.invoice.total,
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
      where: { id: payment.invoice.studentId, schoolId: req.schoolId },
      select: { admissionNo: true, firstName: true, lastName: true },
    });

    await feesAudit(req, {
      action: "FEES_RECEIPT_PDF_VIEWED",
      targetType: "FEE_PAYMENT",
      targetId: id,
    });

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
    doc.text(`Received By: ${payment.receivedBy || "—"}`);
    doc.moveDown();

    doc.text(`Invoice Total: ${payment.invoice.total}`);
    doc.text(`Total Paid: ${payment.invoice.paid}`);
    doc.text(`Balance: ${payment.invoice.balance}`);
    doc.moveDown();

    doc.text("Thank you.", { align: "center" });
    doc.end();
  } catch (err) {
    console.error("RECEIPT PDF ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* --------------------
 * Reports (READ entitlement)
 * --------------------
 * - BURSAR should be able to view reports (read-only)
 */

router.get(
  "/reports/class-summary",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlement("FEES_READ"),
  async (req, res) => {
    try {
      const { classId, year, term, export: exportType } = req.query;
      

      const y = toInt(year, null);
      if (!classId || !y || !term) {
        return res.status(400).json({ message: "classId, year, and term are required." });
      }

      const classRow = await prisma.class.findFirst({
        where: { id: String(classId), schoolId: req.schoolId },
        select: { id: true, name: true, stream: true, year: true },
      });
      if (!classRow) return res.status(400).json({ message: "Invalid classId" });

      const invoices = await prisma.feeInvoice.findMany({
        where: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          status: { not: "VOID" },
        },
        select: { total: true, paid: true, balance: true, status: true },
      });

      
      

      const summary = invoices.reduce(
        (acc, inv) => {
          acc.totalBilled += Number(inv.total || 0);
          acc.totalPaid += Number(inv.paid || 0);
          acc.totalBalance += Number(inv.balance || 0);
          acc.invoiceCount += 1;
          acc.statusCounts[inv.status] = (acc.statusCounts[inv.status] || 0) + 1;
          return acc;
        },
        { totalBilled: 0, totalPaid: 0, totalBalance: 0, invoiceCount: 0, statusCounts: {} }
      );

      await feesAudit(req, {
  action: "REPORTS_FEES_CLASS_SUMMARY_VIEWED",
  targetType: "CLASS",
  targetId: classId,
  metadata: {
    classId: String(classId),
    year: y,
    term: String(term),
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    invoiceCount: summary.invoiceCount,
    totalBilled: summary.totalBilled,
    totalPaid: summary.totalPaid,
    totalBalance: summary.totalBalance,
  },
});


      // ✅ EXPORT MODE
      if (exportType === "csv" || exportType === "xlsx") {
        const rows = [
          {
            classId: classRow.id,
            className: classRow.name,
            stream: classRow.stream || "",
            classYear: classRow.year,
            term: String(term),
            year: y,
            invoiceCount: summary.invoiceCount,
            totalBilled: summary.totalBilled,
            totalPaid: summary.totalPaid,
            totalBalance: summary.totalBalance,
            issued: summary.statusCounts.ISSUED || 0,
            partiallyPaid: summary.statusCounts.PARTIALLY_PAID || 0,
            paid: summary.statusCounts.PAID || 0,
          },
        ];

        const fileBase = `fees-class-summary-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();

        if (exportType === "csv") {
          return exportCSV(res, fileBase, rows);
        }

        return exportXLSX(
          res,
          fileBase,
          "Class Summary",
          [
            { header: "Class ID", key: "classId", width: 18 },
            { header: "Class", key: "className", width: 18 },
            { header: "Stream", key: "stream", width: 10 },
            { header: "Class Year", key: "classYear", width: 10 },
            { header: "Term", key: "term", width: 10 },
            { header: "Year", key: "year", width: 10 },
            { header: "Invoice Count", key: "invoiceCount", width: 14 },
            { header: "Total Billed", key: "totalBilled", width: 14 },
            { header: "Total Paid", key: "totalPaid", width: 14 },
            { header: "Total Balance", key: "totalBalance", width: 14 },
            { header: "ISSUED", key: "issued", width: 10 },
            { header: "PARTIALLY_PAID", key: "partiallyPaid", width: 16 },
            { header: "PAID", key: "paid", width: 10 },
          ],
          rows
        );
      }

      // ✅ NORMAL JSON
      return res.json({
        classId: String(classId),
        year: y,
        term: String(term),
        ...summary,
      });
    } catch (err) {
      console.error("CLASS SUMMARY REPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


router.get(
  "/reports/defaulters",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlement("FEES_READ"),
  async (req, res) => {
    try {
      const { classId, year, term, minBalance = 1, limit = 50, export: exportType } = req.query;

      const y = toInt(year, null);
      const minB = toNumber(minBalance, 1);
      const lim = Math.min(Math.max(toInt(limit, 50), 1), 500);

      if (!classId || !y || !term) {
        return res.status(400).json({ message: "classId, year, and term are required." });
      }

      const classRow = await prisma.class.findFirst({
        where: { id: String(classId), schoolId: req.schoolId },
        select: { id: true, name: true, stream: true, year: true },
      });
      if (!classRow) return res.status(400).json({ message: "Invalid classId" });

      const invoices = await prisma.feeInvoice.findMany({
        where: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          balance: { gt: Number(minB) },
          status: { not: "VOID" },
        },
        orderBy: { balance: "desc" },
        take: lim,
        select: {
          id: true,
          studentId: true,
          total: true,
          paid: true,
          balance: true,
          status: true,
          createdAt: true,
        },
      });

      const studentIds = [...new Set(invoices.map((i) => i.studentId))];

      const students = await prisma.student.findMany({
        where: { id: { in: studentIds }, schoolId: req.schoolId },
        select: { id: true, admissionNo: true, firstName: true, lastName: true },
      });

      const studentMap = new Map(students.map((s) => [s.id, s]));

      const rows = invoices.map((inv) => {
        const st = studentMap.get(inv.studentId);
        return {
          invoiceId: inv.id,
          admissionNo: st?.admissionNo || "",
          studentName: `${st?.firstName || ""} ${st?.lastName || ""}`.trim(),
          total: inv.total,
          paid: inv.paid,
          balance: inv.balance,
          status: inv.status,
          createdAt: inv.createdAt,
        };
      });

      await feesAudit(req, {
  action: "REPORTS_FEES_DEFAULTERS_VIEWED",
  targetType: "CLASS",
  targetId: classId,
  metadata: {
    classId: String(classId),
    year: y,
    term: String(term),
    minBalance: Number(minB),
    limit: lim,
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    resultCount: rows.length,
  },
});


      // ✅ EXPORT MODE
      if (exportType === "csv") {
        const fileBase = `fees-defaulters-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportCSV(res, fileBase, rows);
      }

      if (exportType === "xlsx") {
        const fileBase = `fees-defaulters-${classRow.name}-${String(term)}-${y}`.replace(/\s+/g, "-").toLowerCase();
        return exportXLSX(
          res,
          fileBase,
          "Defaulters",
          [
            { header: "Invoice ID", key: "invoiceId", width: 18 },
            { header: "Admission No", key: "admissionNo", width: 14 },
            { header: "Student Name", key: "studentName", width: 22 },
            { header: "Total", key: "total", width: 12 },
            { header: "Paid", key: "paid", width: 12 },
            { header: "Balance", key: "balance", width: 12 },
            { header: "Status", key: "status", width: 14 },
            { header: "Created At", key: "createdAt", width: 20 },
          ],
          rows
        );
      }

      // ✅ NORMAL JSON
      return res.json({
        classId: String(classId),
        year: y,
        term: String(term),
        minBalance: Number(minB),
        count: rows.length,
        rows: rows.map((r) => ({
          invoiceId: r.invoiceId,
          student: {
            admissionNo: r.admissionNo,
            name: r.studentName,
          },
          total: r.total,
          paid: r.paid,
          balance: r.balance,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      console.error("DEFAULTERS REPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


router.get(
  "/reports/collections",
  requireRole("ADMIN", "BURSAR"),
  requireSubscriptionForReports,
  requireEntitlement("FEES_READ"),
  async (req, res) => {
    try {
      const { from, to, export: exportType } = req.query;
      const { fromDate, toDate } = parseDateRange(from, to);

      const payments = await prisma.feePayment.findMany({
        where: {
          schoolId: req.schoolId,
          receivedAt: { gte: fromDate, lte: toDate },
          isReversed: false,
        },
        orderBy: { receivedAt: "desc" },
      });

      const rows = payments.map((p) => ({
        receiptNo: p.receiptNo,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        receivedAt: p.receivedAt,
      }));

      await feesAudit(req, {
  action: "REPORTS_FEES_COLLECTIONS_VIEWED",
  targetType: "FEES_REPORT",
  targetId: `${from}:${to}`,
  metadata: {
    from,
    to,
    export: exportType === "csv" || exportType === "xlsx" ? exportType : null,
    rows: rows.length,
  },
});


      // 🔹 EXPORT MODE
      if (exportType === "csv") {
        return exportCSV(res, "fees-collections", rows);
      }

      if (exportType === "xlsx") {
        return exportXLSX(
          res,
          "fees-collections",
          "Collections",
          [
            { header: "Receipt No", key: "receiptNo", width: 20 },
            { header: "Amount", key: "amount", width: 12 },
            { header: "Method", key: "method", width: 12 },
            { header: "Reference", key: "reference", width: 20 },
            { header: "Date", key: "receivedAt", width: 20 },
          ],
          rows
        );
      }

      // 🔹 NORMAL JSON RESPONSE
      const totals = payments.reduce(
        (acc, p) => {
          acc.totalCollected += Number(p.amount || 0);
          acc.byMethod[p.method] = (acc.byMethod[p.method] || 0) + p.amount;
          return acc;
        },
        { totalCollected: 0, byMethod: {} }
      );

      return res.json({ from, to, ...totals, payments });
    } catch (err) {
      console.error("COLLECTIONS EXPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


export default router;
