// src/modules/sms/sms.js
// SMS to parents (missing feature 2). Messages go into the SmsMessage outbox
// first and are then sent by the configured provider, so the school can see
// what went out, what failed and why.
//
// Provider (environment):
//   SMS_PROVIDER=africastalking   AT_USERNAME, AT_API_KEY, optional AT_SENDER_ID,
//                                 AT_SANDBOX=true for the sandbox
//   SMS_PROVIDER=memory           tests: kept in memory (sentForTests)
//   unset                         nothing is sent; messages are marked SKIPPED
import { prisma } from "../../lib/prisma.js";

export const sentForTests = [];

function provider() {
  const name = String(process.env.SMS_PROVIDER || "").toLowerCase();
  if (name === "memory") {
    return {
      name,
      async send(to, body) {
        sentForTests.push({ to, body });
        return { ok: true, providerId: `mem-${sentForTests.length}` };
      },
    };
  }
  if (name === "africastalking" && process.env.AT_USERNAME && process.env.AT_API_KEY) {
    const base = String(process.env.AT_SANDBOX) === "true" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
    return {
      name,
      async send(to, body) {
        const form = new URLSearchParams({ username: process.env.AT_USERNAME, to, message: body });
        if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
        const res = await fetch(`${base}/version1/messaging`, {
          method: "POST",
          headers: { apiKey: process.env.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({}));
        const r = data?.SMSMessageData?.Recipients?.[0];
        if (res.ok && r && (r.statusCode === 100 || r.statusCode === 101 || r.statusCode === 102)) {
          return { ok: true, providerId: r.messageId || null };
        }
        return { ok: false, error: r?.status || data?.SMSMessageData?.Message || `HTTP ${res.status}` };
      },
    };
  }
  return null;
}

export const smsConfigured = () => !!provider();

/** Short KES amount for SMS: "KES 12,000". */
export const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;

/**
 * Parents to text about a learner: primary contact(s) who receive SMS. When
 * `all` is set, every guardian who receives SMS (used for broadcasts).
 */
export async function recipientsFor(db, { schoolId, studentId, all = false }) {
  const links = await db.studentGuardian.findMany({
    where: { schoolId, studentId, receivesSms: true, ...(all ? {} : { isPrimary: true }) },
    select: { guardian: { select: { id: true, phone: true } } },
  });
  return links.map((l) => ({ guardianId: l.guardian.id, phone: l.guardian.phone }));
}

/**
 * Every guardian who receives SMS for active learners in these classes (all
 * classes when empty), one entry per phone number, in one query.
 */
export async function familyRecipients(db, { schoolId, classIds = [] }) {
  const links = await db.studentGuardian.findMany({
    where: {
      schoolId,
      receivesSms: true,
      student: { isActive: true, ...(classIds.length ? { classId: { in: classIds } } : {}) },
    },
    select: { guardian: { select: { id: true, phone: true } } },
  });
  const byPhone = new Map();
  for (const l of links) if (l.guardian.phone && !byPhone.has(l.guardian.phone)) byPhone.set(l.guardian.phone, l.guardian.id);
  return [...byPhone].map(([phone, guardianId]) => ({ phone, guardianId }));
}

/** The school's SMS switches; null when SMS is off for the school. */
export async function smsSettings(db, schoolId) {
  const s = await db.schoolSettings.findUnique({
    where: { schoolId },
    select: { smsEnabled: true, smsOnPayment: true, smsOnAbsence: true, smsOnResults: true, smsPaymentInstructions: true },
  });
  return s?.smsEnabled ? s : null;
}

/**
 * Queues messages: [{ to, body, kind, studentId?, guardianId? }]. Returns the
 * rows. Call flushOutbox() afterwards (outside any transaction) to send.
 */
export async function queueSms(db, { schoolId, createdById = null, messages }) {
  const unique = new Map();
  for (const m of messages) {
    if (!m?.to || !m?.body) continue;
    unique.set(`${m.to}|${m.studentId || ""}|${m.kind}|${m.body}`, m); // no exact repeats in one batch
  }
  const rows = [...unique.values()].map((m) => ({
    schoolId,
    to: m.to,
    body: String(m.body).slice(0, 459), // 3 SMS segments at most
    kind: m.kind,
    studentId: m.studentId || null,
    guardianId: m.guardianId || null,
    createdById,
  }));
  if (rows.length) await db.smsMessage.createMany({ data: rows });
  return rows.length;
}

/**
 * Sends one message that holds a secret (a temporary password) right away,
 * and keeps only `stored` (the text with the secret masked) in the outbox.
 * The real text is never saved, so staff reading the SMS log can't see it
 * (audit 2, A2-SEC-04). It's never retried: on failure, issue a new password.
 */
export async function sendSecretSms(db, { schoolId, createdById = null, to, guardianId = null, kind, body, stored }) {
  const p = provider();
  let r = { ok: false, error: "No SMS provider configured" };
  if (p) {
    try {
      r = await p.send(to, body);
    } catch (err) {
      r = { ok: false, error: String(err?.message || err).slice(0, 200) };
    }
  }
  await db.smsMessage.create({
    data: {
      schoolId, to, kind, guardianId, createdById,
      body: String(stored).slice(0, 459),
      attempts: 3, // never picked up again by flushOutbox
      ...(r.ok
        ? { status: "SENT", sentAt: new Date(), providerId: r.providerId || null }
        : { status: p ? "FAILED" : "SKIPPED", error: `${String(r.error || "Failed").slice(0, 150)}. Not retried: it held a password.` }),
    },
  });
  return r.ok;
}

let flushing = null;
/**
 * Sends queued messages (oldest first, a batch at a time). Without a
 * provider they are marked SKIPPED with the reason. Failures are retried on
 * later runs up to 3 attempts. Never throws.
 */
export async function flushOutbox({ limit = 200 } = {}) {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const p = provider();
      const batch = await prisma.smsMessage.findMany({
        where: { OR: [{ status: "QUEUED" }, { status: "FAILED", attempts: { lt: 3 } }] },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      for (const m of batch) {
        // Claim the row before sending: only the instance whose update still
        // finds it unchanged sends it. Without this, two servers flushing at
        // once both sent every message (audit 2, A2-OPS-01). The attempt is
        // counted here, so a crash mid-send is retried at most 3 times.
        const claimed = await prisma.smsMessage.updateMany({
          where: { id: m.id, status: m.status, attempts: m.attempts },
          data: { attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;
        if (!p) {
          await prisma.smsMessage.update({ where: { id: m.id }, data: { status: "SKIPPED", error: "No SMS provider configured" } });
          continue;
        }
        let r;
        try {
          r = await p.send(m.to, m.body);
        } catch (err) {
          r = { ok: false, error: String(err?.message || err).slice(0, 200) };
        }
        await prisma.smsMessage.update({
          where: { id: m.id },
          data: r.ok
            ? { status: "SENT", sentAt: new Date(), providerId: r.providerId || null, error: null }
            : { status: "FAILED", error: String(r.error || "Failed").slice(0, 200) },
        });
      }
      return batch.length;
    } catch (err) {
      console.error("SMS FLUSH ERROR:", err?.message);
      return 0;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Fire-and-forget send after a request has committed its work. */
export function flushSoon() {
  setImmediate(() => {
    flushOutbox().catch(() => {});
  });
}
