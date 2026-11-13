// src/routes/fees/shared.js
// Helpers shared by the fee routers.
import { prisma } from "../../lib/prisma.js";
import { logAudit, actorCtx } from "../../utils/audit.js";
import { getSchoolCalendar, localDayRange, isDateString } from "../../utils/schoolTime.js";
import { lockStudent, applyCredit, reversePayment, nextDocumentNo } from "../../modules/fees/ledger.js";

/* --------------------------------------
 * Helpers
 * -------------------------------------- */

export const ALLOWED_PAYMENT_METHODS = ["CASH", "MPESA", "BANK", "CHEQUE", "OTHER"];

export function normalizePaymentMethod(method) {
  const m = String(method || "CASH").trim().toUpperCase();
  return ALLOWED_PAYMENT_METHODS.includes(m) ? m : null;
}


// Payments on one invoice queue behind its row lock, so allow time to wait
// for a connection and to finish (Prisma's defaults are 2s and 5s).
export const MONEY_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/**
 * An invoice takes its class, year and term from its fee plan. If the request
 * also names them, they must agree (audit finding H7: invoices were generated
 * from another class's plan, for any year). Returns an error message or null.
 */
export function planMismatch(plan, { classId, year, term }) {
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
export async function createInvoiceForStudent(client, { schoolId, studentId, classId, year, term, plan }) {
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



/** One invoice and its number, in one transaction (a failed save frees the number). */
export function createInvoice(args) {
  return prisma.$transaction((tx) => createInvoiceForStudent(tx, args), MONEY_TX_OPTIONS);
}

/** Display names for staff user ids: teacher name, else email. */
export async function staffNames(schoolId, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: list }, schoolId },
    select: { id: true, email: true, teacher: { select: { firstName: true, lastName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.teacher ? `${u.teacher.firstName} ${u.teacher.lastName}`.trim() : u.email]));
}

export function normalizeExportType(v) {
  const x = String(v || "").trim().toLowerCase();
  if (x === "csv" || x === "xlsx") return x;
  return null;
}


/* ------------ Audit helpers ------------ */
export async function feesAudit(req, { schoolId, action, targetType, targetId, metadata }) {
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
/** Report date range: the days are the school's local days (audit M3). */
export async function parseSchoolDateRange(schoolId, from, to) {
  if (!from || !to) throw Object.assign(new Error("from and to are required (YYYY-MM-DD)."), { status: 400 });
  if (!isDateString(from) || !isDateString(to)) {
    throw Object.assign(new Error("Invalid date format. Use YYYY-MM-DD."), { status: 400 });
  }
  if (from > to) throw Object.assign(new Error("from must be less than or equal to to."), { status: 400 });
  const { timezone } = await getSchoolCalendar(schoolId);
  const { from: fromDate, to: toDate } = localDayRange(from, to, timezone);
  return { fromDate, toDate };
}


export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Reverses a payment (ledger.reversePayment) and settles any open requests for it. */
export async function reversePaymentTx(tx, { schoolId, paymentId, actorId, reason }) {
  const result = await reversePayment(tx, { schoolId, paymentId, actorId, reason });
  await tx.feeReversalRequest.updateMany({
    where: { paymentId: String(paymentId), status: "PENDING" },
    data: { status: "APPROVED", decidedBy: actorId || null, decidedAt: new Date(), decisionNote: "Reversed directly" },
  });
  return result;
}

export function sendFeesError(res, err, label) {
  if (!err?.status) console.error(`${label}:`, err);
  return res.status(err?.status || 500).json({ message: err?.status ? err.message : "Server error" });
}
