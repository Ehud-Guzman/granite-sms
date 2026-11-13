// src/modules/sms/notify.js
// Automatic messages to parents. Each one checks the school's switches, is
// queued in the outbox, and never makes the action that triggered it fail.
import { prisma } from "../../lib/prisma.js";
import { accountSummary } from "../fees/ledger.js";
import { queueSms, recipientsFor, smsSettings, flushSoon, kes } from "./sms.js";

async function schoolName(schoolId) {
  const s = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, shortName: true } });
  return s?.shortName || s?.name || "School";
}

function safe(label, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`SMS ${label} ERROR:`, err?.message);
      return 0;
    }
  };
}

/** "School: received KES 5,000 for Amani Otieno (ADM-1). Receipt RCPT-2026-000012. Balance KES 12,000." */
export const notifyPayment = safe("PAYMENT", async ({ schoolId, paymentId, actorId }) => {
  const settings = await smsSettings(prisma, schoolId);
  if (!settings?.smsOnPayment) return 0;
  const p = await prisma.feePayment.findUnique({
    where: { id: paymentId },
    include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
  });
  if (!p || p.isReversed) return 0;
  const [name, acct, to] = await Promise.all([
    schoolName(schoolId),
    accountSummary(prisma, { schoolId, studentId: p.studentId }),
    recipientsFor(prisma, { schoolId, studentId: p.studentId }),
  ]);
  const tail = acct.net > 0 ? `Balance ${kes(acct.net)}.` : acct.net < 0 ? `Credit ${kes(-acct.net)}.` : "Fully paid.";
  const body = `${name}: received ${kes(p.amount)} for ${p.student.firstName} ${p.student.lastName} (${p.student.admissionNo}). Receipt ${p.receiptNo}. ${tail}`;
  const n = await queueSms(prisma, {
    schoolId,
    createdById: actorId,
    messages: to.map((r) => ({ to: r.phone, guardianId: r.guardianId, studentId: p.studentId, kind: "PAYMENT", body })),
  });
  if (n) flushSoon();
  return n;
});

/** Absence alert for every learner marked ABSENT on a submitted register. */
export const notifyAbsences = safe("ABSENCE", async ({ schoolId, sessionId, actorId }) => {
  const settings = await smsSettings(prisma, schoolId);
  if (!settings?.smsOnAbsence) return 0;
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { date: true, records: { where: { status: "ABSENT" }, select: { student: { select: { id: true, firstName: true, admissionNo: true } } } } },
  });
  if (!session?.records.length) return 0;
  const name = await schoolName(schoolId);
  const day = session.date.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
  const messages = [];
  for (const r of session.records) {
    const to = await recipientsFor(prisma, { schoolId, studentId: r.student.id });
    const body = `${name}: ${r.student.firstName} (${r.student.admissionNo}) was marked absent on ${day}. Please contact the school if this is unexpected.`;
    for (const t of to) messages.push({ to: t.phone, guardianId: t.guardianId, studentId: r.student.id, kind: "ABSENCE", body });
  }
  const n = await queueSms(prisma, { schoolId, createdById: actorId, messages });
  if (n) flushSoon();
  return n;
});

/** "School: Amani's End term 1 results are out: average 71, grade B+, position 2 of 40." */
export const notifyResults = safe("RESULTS", async ({ schoolId, sessionId, actorId }) => {
  const settings = await smsSettings(prisma, schoolId);
  if (!settings?.smsOnResults) return 0;
  const publish = await prisma.resultPublish.findFirst({
    where: { schoolId, examSessionId: sessionId },
    select: {
      examSession: { select: { name: true, term: true, year: true, examType: { select: { name: true } } } },
      studentResults: { select: { studentId: true, studentName: true, averageScore: true, overallGrade: true, position: true } },
    },
  });
  if (!publish) return 0;
  const name = await schoolName(schoolId);
  const exam = publish.examSession.name || `${publish.examSession.examType?.name || "Exam"} ${publish.examSession.term}`;
  const outOf = publish.studentResults.length;
  const messages = [];
  for (const r of publish.studentResults) {
    const to = await recipientsFor(prisma, { schoolId, studentId: r.studentId });
    const first = String(r.studentName || "").split(" ")[0] || "Your child";
    const body = `${name}: ${first}'s ${exam} results are out: average ${r.averageScore}${r.overallGrade ? `, grade ${r.overallGrade}` : ""}${r.position ? `, position ${r.position} of ${outOf}` : ""}.`;
    for (const t of to) messages.push({ to: t.phone, guardianId: t.guardianId, studentId: r.studentId, kind: "RESULTS", body });
  }
  const n = await queueSms(prisma, { schoolId, createdById: actorId, messages });
  if (n) flushSoon();
  return n;
});
