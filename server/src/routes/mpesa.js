// src/routes/mpesa.js
// M-Pesa for a school (missing feature 3).
//
// Staff (base /api/mpesa):
//   GET  /config                     ADMIN   set-up (secrets never returned)
//   PUT  /config                     ADMIN   { shortcode, kind, environment, consumerKey?, consumerSecret?, passkey?, isActive? }
//   POST /register-urls              ADMIN   tell Safaricom where to send payments
//   GET  /transactions               ADMIN, BURSAR  ?status=UNMATCHED
//   POST /transactions/:id/assign    ADMIN, BURSAR  { studentId }
//   POST /transactions/:id/ignore    ADMIN   { note }
//   POST /stk                        ADMIN, BURSAR  { studentId, amount, phone? } payment prompt
//
// Safaricom (public, see publicRouter): /api/public/mpesa/:token/...
import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { seal, secretBoxReady } from "../utils/secretBox.js";
import { normalizeKenyanPhone } from "../utils/phone.js";
import { registerC2bUrls, stkPush, callbackUrls, parseTransTime } from "../modules/mpesa/daraja.js";
import { recordMpesaPayment, assignMpesaTransaction } from "../modules/mpesa/ingest.js";

const router = Router();
router.use(requireTenant);

const view = (c) =>
  c && {
    shortcode: c.shortcode,
    kind: c.kind,
    environment: c.environment,
    isActive: c.isActive,
    hasConsumerKey: !!c.consumerKeyEnc,
    hasConsumerSecret: !!c.consumerSecretEnc,
    hasPasskey: !!c.passkeyEnc,
    urlsRegisteredAt: c.urlsRegisteredAt,
  };

router.get("/config", requireRole("ADMIN"), async (req, res) => {
  const c = await prisma.mpesaConfig.findUnique({ where: { schoolId: req.schoolId } });
  let urls = null;
  try {
    urls = c ? callbackUrls(c) : null;
  } catch {
    urls = null;
  }
  return res.json({ config: view(c), callbackUrls: urls, serverReady: secretBoxReady() && !!process.env.PUBLIC_API_URL });
});

router.put("/config", requireRole("ADMIN"), async (req, res) => {
  const b = req.body || {};
  const shortcode = String(b.shortcode || "").trim();
  if (!/^\d{5,7}$/.test(shortcode)) return res.status(400).json({ message: "shortcode must be your 5–7 digit paybill or till number" });
  const kind = String(b.kind || "PAYBILL").toUpperCase();
  if (!["PAYBILL", "TILL"].includes(kind)) return res.status(400).json({ message: "kind must be PAYBILL or TILL" });
  const environment = String(b.environment || "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(environment)) return res.status(400).json({ message: "environment must be sandbox or production" });

  const secrets = {};
  for (const [field, col] of [["consumerKey", "consumerKeyEnc"], ["consumerSecret", "consumerSecretEnc"], ["passkey", "passkeyEnc"]]) {
    if (b[field]) secrets[col] = seal(String(b[field]).trim());
  }
  const data = { shortcode, kind, environment, ...secrets, ...("isActive" in b ? { isActive: !!b.isActive } : {}) };
  const c = await prisma.mpesaConfig.upsert({
    where: { schoolId: req.schoolId },
    update: data,
    create: { schoolId: req.schoolId, callbackToken: crypto.randomBytes(24).toString("base64url"), ...data },
  });
  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "MPESA_CONFIG_UPDATED",
    targetType: "SCHOOL",
    targetId: req.schoolId,
    metadata: { shortcode, kind, environment, secretsChanged: Object.keys(secrets) },
  });
  return res.json({ config: view(c) });
});

router.post("/register-urls", requireRole("ADMIN"), async (req, res) => {
  const c = await prisma.mpesaConfig.findUnique({ where: { schoolId: req.schoolId } });
  if (!c) return res.status(400).json({ message: "Save the M-Pesa set-up first." });
  const r = await registerC2bUrls(c);
  await prisma.mpesaConfig.update({ where: { id: c.id }, data: { urlsRegisteredAt: new Date() } });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "MPESA_URLS_REGISTERED", targetType: "SCHOOL", targetId: req.schoolId });
  return res.json({ ok: true, response: r?.ResponseDescription || null });
});

router.get("/transactions", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  if (status && !["MATCHED", "UNMATCHED", "ASSIGNED", "IGNORED"].includes(status)) {
    return res.status(400).json({ message: "status must be MATCHED, UNMATCHED, ASSIGNED or IGNORED" });
  }
  const where = { schoolId: req.schoolId, ...(status ? { status } : {}) };

  // ?page=N: one page plus how many there are in each state (for the tabs).
  if (req.query.page !== undefined) {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const [items, total, grouped] = await Promise.all([
      prisma.mpesaTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.mpesaTransaction.count({ where }),
      prisma.mpesaTransaction.groupBy({ by: ["status"], where: { schoolId: req.schoolId }, _count: true }),
    ]);
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
    return res.json({ items, total, page, pageSize, counts });
  }

  const items = await prisma.mpesaTransaction.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  return res.json({ items });
});

router.post("/transactions/:id/assign", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  if (!req.body?.studentId) return res.status(400).json({ message: "studentId is required" });
  const out = await assignMpesaTransaction({ schoolId: req.schoolId, id: req.params.id, studentId: req.body.studentId, actorId: req.user.id });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "FEES_MPESA_PAYMENT_ASSIGNED", targetType: "MPESA", targetId: out.transId, metadata: { studentId: req.body.studentId } });
  return res.json(out);
});

router.post("/transactions/:id/ignore", requireRole("ADMIN"), async (req, res) => {
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ message: "Say why (e.g. refunded to the payer)." });
  const r = await prisma.mpesaTransaction.updateMany({
    where: { id: String(req.params.id), schoolId: req.schoolId, status: "UNMATCHED" },
    data: { status: "IGNORED", note: note.slice(0, 200) },
  });
  if (!r.count) return res.status(409).json({ message: "Only an unmatched payment can be set aside." });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "FEES_MPESA_PAYMENT_IGNORED", targetType: "MPESA", targetId: req.params.id, metadata: { note } });
  return res.json({ ok: true });
});

router.post("/stk", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const c = await prisma.mpesaConfig.findUnique({ where: { schoolId: req.schoolId } });
  if (!c?.isActive) return res.status(400).json({ message: "M-Pesa is not set up for this school." });
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isInteger(amount) || amount < 1 || amount > 250000) return res.status(400).json({ message: "amount must be 1–250,000" });
  const student = await prisma.student.findFirst({
    where: { id: String(req.body?.studentId || ""), schoolId: req.schoolId },
    select: { id: true, admissionNo: true, guardianLinks: { where: { isPrimary: true }, select: { guardian: { select: { phone: true } } } } },
  });
  if (!student) return res.status(404).json({ message: "Student not found" });
  const phone = normalizeKenyanPhone(req.body?.phone || student.guardianLinks[0]?.guardian.phone);
  if (!phone) return res.status(400).json({ message: "Give a Kenyan mobile number for the prompt." });

  const r = await stkPush(c, { phone, amount, accountReference: student.admissionNo, description: "School fees" });
  await prisma.mpesaStkRequest.create({
    data: { schoolId: req.schoolId, checkoutRequestId: r.CheckoutRequestID, studentId: student.id, amount, phone, requestedById: req.user.id },
  });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "FEES_MPESA_STK_SENT", targetType: "STUDENT", targetId: student.id, metadata: { amount } });
  return res.json({ ok: true, checkoutRequestId: r.CheckoutRequestID, message: r.CustomerMessage || "Prompt sent" });
});

export default router;

// ---------------------------------------------------------------------------
// Safaricom callbacks. Public, so each school's URLs carry a long random
// token; optionally also restricted to Safaricom's IPs (MPESA_ALLOWED_IPS).
// Safaricom always gets "accepted" back: a payment we can't match still
// goes in the unmatched list rather than being refused.
// ---------------------------------------------------------------------------
export const publicRouter = Router();
const ACCEPT = { ResultCode: 0, ResultDesc: "Accepted" };

async function configFor(req, res) {
  const allowed = String(process.env.MPESA_ALLOWED_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(req.ip)) {
    res.status(403).json({ ResultCode: 1, ResultDesc: "Rejected" });
    return null;
  }
  const c = await prisma.mpesaConfig.findUnique({ where: { callbackToken: String(req.params.token) } });
  if (!c?.isActive) {
    res.status(404).json({ ResultCode: 1, ResultDesc: "Unknown" });
    return null;
  }
  return c;
}

publicRouter.post("/:token/c2b/validation", async (req, res) => {
  if (!(await configFor(req, res))) return;
  return res.json(ACCEPT);
});

publicRouter.post("/:token/c2b/confirmation", async (req, res) => {
  const c = await configFor(req, res);
  if (!c) return;
  const b = req.body || {};
  if (String(b.BusinessShortCode || c.shortcode) !== c.shortcode) return res.json(ACCEPT);
  try {
    await recordMpesaPayment({
      schoolId: c.schoolId,
      transId: b.TransID,
      amount: b.TransAmount,
      billRef: b.BillRefNumber,
      msisdn: b.MSISDN,
      payerName: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(" "),
      transTime: parseTransTime(b.TransTime),
      source: "C2B",
    });
  } catch (err) {
    console.error("MPESA C2B ERROR:", err?.message);
  }
  return res.json(ACCEPT);
});

publicRouter.post("/:token/stk", async (req, res) => {
  const c = await configFor(req, res);
  if (!c) return;
  const cb = req.body?.Body?.stkCallback || {};
  try {
    const pending = await prisma.mpesaStkRequest.findUnique({ where: { checkoutRequestId: String(cb.CheckoutRequestID || "") } });
    if (pending && pending.schoolId === c.schoolId && pending.status === "PENDING") {
      if (Number(cb.ResultCode) === 0) {
        const item = (n) => (cb.CallbackMetadata?.Item || []).find((i) => i.Name === n)?.Value;
        const student = await prisma.student.findUnique({ where: { id: pending.studentId }, select: { admissionNo: true } });
        await recordMpesaPayment({
          schoolId: c.schoolId,
          transId: item("MpesaReceiptNumber"),
          amount: item("Amount") ?? pending.amount,
          billRef: student?.admissionNo,
          msisdn: String(item("PhoneNumber") || pending.phone),
          transTime: parseTransTime(item("TransactionDate")),
          source: "STK",
          studentId: pending.studentId,
        });
        await prisma.mpesaStkRequest.update({ where: { id: pending.id }, data: { status: "PAID", resultDesc: cb.ResultDesc || null } });
      } else {
        await prisma.mpesaStkRequest.update({ where: { id: pending.id }, data: { status: "FAILED", resultDesc: String(cb.ResultDesc || "").slice(0, 200) } });
      }
    }
  } catch (err) {
    console.error("MPESA STK ERROR:", err?.message);
  }
  return res.json(ACCEPT);
});
