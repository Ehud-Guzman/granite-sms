// src/routes/fees.js
import { Router } from "express";
import PDFDocument from "pdfkit";
import { Term, InvoiceStatus } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, requireEntitlement, requireEntitlementRead } from "../middleware/subscription.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { exportCSV, exportXLSX } from "../utils/export.js";
import { toInt, toNumber } from "../utils/validate.js";
import { getSchoolCalendar, localDayRange, localDateString, isDateString } from "../utils/schoolTime.js";
import {
  computeInvoiceStatus,
  lockInvoice,
  lockStudent,
  recomputeInvoice,
  allocatePayment,
  applyCredit,
  accountSummary,
  reversePayment,
} from "../modules/fees/ledger.js";
import { notifyPayment } from "../modules/sms/notify.js";


const router = Router();

/**
 * Assumptions:
 * - requireAuth + tenantContext already ran before hitting /api/fees
 * - requireTenant enforces tenant presence (req.schoolId)
 */
router.use(requireTenant);
router.use(loadSubscription);

/**
 * Rejects bad term / status / year values up front with a 400. Before this,
 * e.g. ?term=BOGUS reached Prisma as an invalid enum and came back as a 500.
 */
const TERMS = Object.values(Term);
const INVOICE_STATUSES = Object.values(InvoiceStatus);
router.use((req, res, next) => {
  const sources = [req.query || {}, req.body && typeof req.body === "object" ? req.body : {}];
  for (const src of sources) {
    if (src.term !== undefined && src.term !== "" && !TERMS.includes(String(src.term))) {
      return res.status(400).json({ message: `term must be one of: ${TERMS.join(", ")}.` });
    }
    if (src.year !== undefined && src.year !== "") {
      const y = Number(src.year);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) {
        return res.status(400).json({ message: "year must be a whole number between 2000 and 2100." });
      }
    }
  }
  const st = req.query?.status;
  if (req.path.startsWith("/invoices") && st && !INVOICE_STATUSES.includes(String(st))) {
    return res.status(400).json({ message: `status must be one of: ${INVOICE_STATUSES.join(", ")}.` });
  }
  next();
});

/* --------------------------------------
 * Helpers
 * -------------------------------------- */

const ALLOWED_PAYMENT_METHODS = ["CASH", "MPESA", "BANK", "CHEQUE", "OTHER"];

function normalizePaymentMethod(method) {
  const m = String(method || "CASH").trim().toUpperCase();
  return ALLOWED_PAYMENT_METHODS.includes(m) ? m : null;
}


// Payments on one invoice queue behind its row lock, so allow time to wait
// for a connection and to finish (Prisma's defaults are 2s and 5s).
const MONEY_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/**
 * An invoice takes its class, year and term from its fee plan. If the request
 * also names them, they must agree (audit finding H7: invoices were generated
 * from another class's plan, for any year). Returns an error message or null.
 */
function planMismatch(plan, { classId, year, term }) {
  if (!plan.isActive) return "This fee plan is inactive.";
  if (classId && String(classId) !== plan.classId) return "This fee plan belongs to a different class.";
  if (year && Number(year) !== plan.year) return `This fee plan is for ${plan.year}, not ${year}.`;
  if (term && String(term) !== plan.term) return `This fee plan is for ${plan.term}, not ${term}.`;
  return null;
}

/**
 * Creates a single FeeInvoice (+ lines) from a FeePlan, inside the given
 * prisma client (pass `tx` inside a $transaction, or `prisma` standalone).
 * Shared by both the single-student and bulk invoice generation routes.
 */
async function createInvoiceForStudent(client, { schoolId, studentId, classId, year, term, plan }) {
  const total = (plan.items || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  await lockStudent(client, schoolId, studentId);
  const invoice = await client.feeInvoice.create({
    data: {
      schoolId,
      studentId: String(studentId),
      classId: String(classId),
      year: Number(year),
      term: String(term),
      invoiceNo: await nextDocumentNo(client, { schoolId, kind: "INVOICE", year: Number(year), prefix: "INV" }),
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
  });
  // Money the learner already paid ahead (credit) goes on the new invoice.
  await applyCredit(client, { schoolId, studentId: String(studentId) });
  return client.feeInvoice.findUnique({ where: { id: invoice.id }, include: { lines: true } });
}


/**
 * Next number in a per-school, per-year sequence, e.g. RCPT-2026-000123.
 * One atomic statement (INSERT ... ON CONFLICT ... RETURNING), and it runs
 * inside the caller's transaction, so a document that fails to save gives
 * its number back and the sequence has no gaps (audit M6).
 */
async function nextDocumentNo(tx, { schoolId, kind, year, prefix }) {
  const rows = await tx.$queryRaw`
    INSERT INTO "DocumentCounter" ("schoolId", kind, year, next)
    VALUES (${String(schoolId)}, ${kind}, ${Number(year)}, 1)
    ON CONFLICT ("schoolId", kind, year) DO UPDATE SET next = "DocumentCounter".next + 1
    RETURNING next`;
  return `${prefix}-${year}-${String(rows[0].next).padStart(6, "0")}`;
}

/** One invoice and its number, in one transaction (a failed save frees the number). */
function createInvoice(args) {
  return prisma.$transaction((tx) => createInvoiceForStudent(tx, args), MONEY_TX_OPTIONS);
}

/** Display names for staff user ids: teacher name, else email. */
async function staffNames(schoolId, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: list }, schoolId },
    select: { id: true, email: true, teacher: { select: { firstName: true, lastName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.teacher ? `${u.teacher.firstName} ${u.teacher.lastName}`.trim() : u.email]));
}

function normalizeExportType(v) {
  const x = String(v || "").trim().toLowerCase();
  if (x === "csv" || x === "xlsx") return x;
  return null;
}


/* ------------ Audit helpers ------------ */
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
 * Strong date-range parsing for reports
 * -------------------------------------- */
/** Like parseDateRange, but the days are the school's local days (audit M3). */
async function parseSchoolDateRange(schoolId, from, to) {
  if (!from || !to) throw Object.assign(new Error("from and to are required (YYYY-MM-DD)."), { status: 400 });
  if (!isDateString(from) || !isDateString(to)) {
    throw Object.assign(new Error("Invalid date format. Use YYYY-MM-DD."), { status: 400 });
  }
  if (from > to) throw Object.assign(new Error("from must be less than or equal to to."), { status: 400 });
  const { timezone } = await getSchoolCalendar(schoolId);
  const { from: fromDate, to: toDate } = localDayRange(from, to, timezone);
  return { fromDate, toDate };
}

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

// SYSTEM_ADMIN only: this endpoint can set arbitrary entitlements/status/period
// on a school's subscription. It was previously ADMIN-gated ("demo setup"), which
// let any tenant ADMIN self-grant arbitrary entitlements (e.g. {"FEES_WRITE":true,
// "ANYTHING_ELSE":true}) and an ACTIVE status with any currentPeriodEnd, bypassing
// the SYSTEM_ADMIN-only /api/settings/subscription control plane entirely.
router.post("/subscription", requireRole("SYSTEM_ADMIN"), async (req, res) => {
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
  const includeInactive = String(req.query?.includeInactive || "") === "1";

  const plans = await prisma.feePlan.findMany({
    where: {
      schoolId: req.schoolId,
      classId: classId || undefined,
      year: year ?? undefined,
      term: term || undefined,
      isActive: includeInactive ? undefined : true,
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

    // FeePlanItem.amount is a required, non-nullable integer column that feeds
    // directly into invoice totals — reject negative/fractional amounts up front
    // instead of letting a bad plan silently produce a negative or wrong invoice total.
    for (const it of items) {
      const amt = Number(it.amount);
      if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt < 0) {
        return res.status(400).json({
          message: "Each item.amount must be a non-negative whole number.",
        });
      }
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

router.patch(
  "/plans/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;
    const { title, isActive, items } = req.body || {};

    const existing = await prisma.feePlan.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee plan not found." });

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length < 1) {
        return res.status(400).json({ message: "items[] must be a non-empty array." });
      }

      const feeItemIds = items.map((it) => String(it.feeItemId));
      if (new Set(feeItemIds).size !== feeItemIds.length) {
        return res.status(400).json({ message: "Duplicate feeItemId in items[]." });
      }

      const validItems = await prisma.feeItem.findMany({
        where: { id: { in: feeItemIds }, schoolId: req.schoolId, isActive: true },
        select: { id: true },
      });
      const validSet = new Set(validItems.map((x) => x.id));
      const bad = feeItemIds.filter((fid) => !validSet.has(fid));
      if (bad.length) {
        return res.status(400).json({ message: `Invalid feeItemId(s): ${bad.join(", ")}` });
      }

      // Same guard as plan creation: reject negative/fractional amounts before
      // they end up baked into a replacement set of invoice line items.
      for (const it of items) {
        const amt = Number(it.amount);
        if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt < 0) {
          return res.status(400).json({
            message: "Each item.amount must be a non-negative whole number.",
          });
        }
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (items !== undefined) {
          await tx.feePlanItem.deleteMany({ where: { feePlanId: existing.id } });
        }

        return tx.feePlan.update({
          where: { id: existing.id },
          data: {
            title: title !== undefined ? (title ? String(title) : null) : undefined,
            isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            items:
              items !== undefined
                ? {
                    create: items.map((it) => ({
                      feeItemId: String(it.feeItemId),
                      amount: Number(it.amount),
                      required: it.required !== undefined ? Boolean(it.required) : true,
                    })),
                  }
                : undefined,
          },
          include: { items: { include: { feeItem: true } } },
        });
      });

      await feesAudit(req, {
        action: "FEES_PLAN_UPDATED",
        targetType: "FEE_PLAN",
        targetId: id,
        metadata: { before: existing, itemsReplaced: items !== undefined },
      });

      return res.json(updated);
    } catch (err) {
      console.error("UPDATE PLAN ERROR:", err);
      return res.status(409).json({ message: "Update failed (duplicate fee item?)" });
    }
  }
);

router.delete(
  "/plans/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;

    const updated = await prisma.feePlan.updateMany({
      where: { id: String(id), schoolId: req.schoolId },
      data: { isActive: false },
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "Fee plan not found." });
    }

    await feesAudit(req, {
      action: "FEES_PLAN_DEACTIVATED",
      targetType: "FEE_PLAN",
      targetId: id,
    });

    return res.json({ message: "Fee plan deactivated." });
  }
);

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

/* --------------------
 * Payment reversals
 * --------------------
 * ADMIN reverses directly. BURSAR (who handles the cash) can only *request*
 * a reversal; an ADMIN approves or rejects it. Audit finding H5: a bursar
 * reversing their own receipts is the classic way cash goes missing.
 */

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Reverses a payment (ledger.reversePayment) and settles any open requests for it. */
async function reversePaymentTx(tx, { schoolId, paymentId, actorId, reason }) {
  const result = await reversePayment(tx, { schoolId, paymentId, actorId, reason });
  await tx.feeReversalRequest.updateMany({
    where: { paymentId: String(paymentId), status: "PENDING" },
    data: { status: "APPROVED", decidedBy: actorId || null, decidedAt: new Date(), decisionNote: "Reversed directly" },
  });
  return result;
}

function sendFeesError(res, err, label) {
  if (!err?.status) console.error(`${label}:`, err);
  return res.status(err?.status || 500).json({ message: err?.status ? err.message : "Server error" });
}

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

/* --------------------
 * Reports (READ entitlement)
 * --------------------
 * - BURSAR should be able to view reports (read-only)
 */

router.get(
  "/reports/class-summary",
  requireRole("ADMIN", "BURSAR"),
  requireEntitlementRead("FEES_READ"),
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
  requireEntitlementRead("FEES_READ"),
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
  requireEntitlementRead("FEES_READ"),
  async (req, res) => {
    try {
      const { from, to, export: exportType } = req.query;
      const { fromDate, toDate } = await parseSchoolDateRange(req.schoolId, from, to);

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
      if (err?.status) return res.status(err.status).json({ message: err.message });
      console.error("COLLECTIONS EXPORT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


export default router;
