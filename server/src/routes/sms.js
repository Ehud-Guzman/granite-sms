// src/routes/sms.js
// SMS to parents. Base: /api/sms
//
//   GET   /settings          ADMIN          switches + whether a provider is set up
//   PATCH /settings          ADMIN
//   GET   /messages          ADMIN, BURSAR  outbox (?status=&kind=&page=)
//   POST  /fee-reminders     ADMIN, BURSAR  { classId?, minBalance?, dryRun? }
//   POST  /broadcast         ADMIN          { classIds?: [], message, dryRun? }
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { accountSummary } from "../modules/fees/ledger.js";
import { queueSms, recipientsFor, familyRecipients, smsConfigured, flushSoon, kes } from "../modules/sms/sms.js";

const router = Router();
router.use(requireTenant);

const SETTINGS = ["smsEnabled", "smsOnPayment", "smsOnAbsence", "smsOnResults", "smsPaymentInstructions"];

router.get("/settings", requireRole("ADMIN"), async (req, res) => {
  const s = await prisma.schoolSettings.upsert({ where: { schoolId: req.schoolId }, update: {}, create: { schoolId: req.schoolId } });
  return res.json({ settings: Object.fromEntries(SETTINGS.map((k) => [k, s[k]])), providerConfigured: smsConfigured() });
});

router.patch("/settings", requireRole("ADMIN"), async (req, res) => {
  const data = {};
  for (const k of ["smsEnabled", "smsOnPayment", "smsOnAbsence", "smsOnResults"]) if (k in (req.body || {})) data[k] = !!req.body[k];
  if ("smsPaymentInstructions" in (req.body || {})) {
    data.smsPaymentInstructions = String(req.body.smsPaymentInstructions || "").trim().slice(0, 120) || null;
  }
  const s = await prisma.schoolSettings.upsert({ where: { schoolId: req.schoolId }, update: data, create: { schoolId: req.schoolId, ...data } });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "SMS_SETTINGS_UPDATED", targetType: "SCHOOL_SETTINGS", targetId: req.schoolId, metadata: data });
  return res.json({ settings: Object.fromEntries(SETTINGS.map((k) => [k, s[k]])), providerConfigured: smsConfigured() });
});

router.get("/messages", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const where = {
    schoolId: req.schoolId,
    ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}),
    ...(req.query.kind ? { kind: String(req.query.kind).toUpperCase() } : {}),
  };
  if (where.status && !["QUEUED", "SENT", "FAILED", "SKIPPED"].includes(where.status)) {
    return res.status(400).json({ message: "status must be QUEUED, SENT, FAILED or SKIPPED" });
  }
  const [items, total] = await Promise.all([
    prisma.smsMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.smsMessage.count({ where }),
  ]);
  return res.json({ items, total, page, pageSize: 50, providerConfigured: smsConfigured() });
});

async function requireSmsOn(req, res) {
  const s = await prisma.schoolSettings.findUnique({ where: { schoolId: req.schoolId }, select: { smsEnabled: true, smsPaymentInstructions: true } });
  if (!s?.smsEnabled) {
    res.status(400).json({ message: "SMS is switched off for this school (Settings > SMS).", code: "SMS_DISABLED" });
    return null;
  }
  return s;
}

/** Fee balance reminders to primary parents of learners who owe at least minBalance. */
router.post("/fee-reminders", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const settings = await requireSmsOn(req, res);
  if (!settings) return;
  const minBalance = Math.max(parseInt(req.body?.minBalance, 10) || 1, 1);
  const dryRun = req.body?.dryRun === true;

  const school = await prisma.school.findUnique({ where: { id: req.schoolId }, select: { name: true, shortName: true } });
  const name = school?.shortName || school?.name || "School";
  const students = await prisma.student.findMany({
    where: { schoolId: req.schoolId, isActive: true, ...(req.body?.classId ? { classId: String(req.body.classId) } : {}) },
    select: { id: true, firstName: true, admissionNo: true },
  });

  const messages = [];
  let learners = 0;
  for (const st of students) {
    const acct = await accountSummary(prisma, { schoolId: req.schoolId, studentId: st.id });
    if (acct.net < minBalance) continue;
    const to = await recipientsFor(prisma, { schoolId: req.schoolId, studentId: st.id });
    if (!to.length) continue;
    learners += 1;
    const body = `${name}: ${st.firstName}'s (${st.admissionNo}) fee balance is ${kes(acct.net)}.${settings.smsPaymentInstructions ? ` ${settings.smsPaymentInstructions}` : ""} Thank you.`;
    for (const t of to) messages.push({ to: t.phone, guardianId: t.guardianId, studentId: st.id, kind: "FEE_REMINDER", body });
  }

  if (dryRun) return res.json({ dryRun: true, learners, messages: messages.length, sample: messages.slice(0, 3).map((m) => m.body) });
  const queued = await queueSms(prisma, { schoolId: req.schoolId, createdById: req.user.id, messages });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "SMS_FEE_REMINDERS_SENT", targetType: "SCHOOL", targetId: req.schoolId, metadata: { learners, queued, minBalance, classId: req.body?.classId || null } });
  flushSoon();
  return res.json({ dryRun: false, learners, queued, providerConfigured: smsConfigured() });
});

/** A message to parents of one or more classes, or the whole school. One per phone number. */
router.post("/broadcast", requireRole("ADMIN"), async (req, res) => {
  const settings = await requireSmsOn(req, res);
  if (!settings) return;
  const text = String(req.body?.message || "").trim();
  if (text.length < 5) return res.status(400).json({ message: "Write the message (at least 5 characters)." });
  if (text.length > 400) return res.status(400).json({ message: "Keep it under 400 characters (3 SMS)." });
  const dryRun = req.body?.dryRun === true;
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map(String) : [];

  const school = await prisma.school.findUnique({ where: { id: req.schoolId }, select: { name: true, shortName: true } });
  const body = `${school?.shortName || school?.name || "School"}: ${text}`;
  const to = await familyRecipients(prisma, { schoolId: req.schoolId, classIds });
  if (dryRun) return res.json({ dryRun: true, recipients: to.length, body });
  const queued = await queueSms(prisma, {
    schoolId: req.schoolId,
    createdById: req.user.id,
    messages: to.map((t) => ({ to: t.phone, guardianId: t.guardianId, kind: "BROADCAST", body })),
  });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "SMS_BROADCAST_SENT", targetType: "SCHOOL", targetId: req.schoolId, metadata: { queued, classIds, length: text.length } });
  flushSoon();
  return res.json({ dryRun: false, queued, providerConfigured: smsConfigured() });
});

export default router;
