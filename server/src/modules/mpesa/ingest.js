// src/modules/mpesa/ingest.js
// Turns an M-Pesa payment into a fee payment. The account number the parent
// typed (BillRefNumber) is matched to an admission number; if it matches,
// the money goes through the ledger like any payment (arrears first, then
// credit) and the parent gets the receipt SMS. If not, it waits in the
// unmatched list for the bursar. Safaricom can send the same payment more
// than once: the M-Pesa receipt (TransID) is unique, so repeats are ignored.
import { prisma } from "../../lib/prisma.js";
import { lockStudent, allocatePayment, nextDocumentNo } from "../fees/ledger.js";
import { getSchoolCalendar, localDateString } from "../../utils/schoolTime.js";
import { notifyPayment } from "../sms/notify.js";
import { logAudit } from "../../utils/audit.js";

const norm = (v) => String(v || "").toUpperCase().replace(/[\s\-_/.]/g, "");

/** The learner whose admission number matches what the payer typed, or null. */
export async function matchAdmission(schoolId, billRef) {
  const ref = norm(billRef);
  if (!ref) return null;
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Student"
    WHERE "schoolId" = ${schoolId}
      AND regexp_replace(upper("admissionNo"), '[\\s\\-_/.]', '', 'g') = ${ref}
    LIMIT 2`;
  return rows.length === 1 ? rows[0].id : null; // ambiguous = no match
}

/** Inside a transaction: creates the fee payment for an M-Pesa receipt. */
async function postPayment(tx, { schoolId, studentId, transId, amount, msisdn, at, timezone }) {
  await lockStudent(tx, schoolId, studentId);
  const payment = await tx.feePayment.create({
    data: {
      schoolId,
      studentId,
      invoiceId: null,
      clientTxnId: `mpesa:${transId}`,
      amount,
      method: "MPESA",
      reference: transId,
      receivedBy: null,
      receiptNo: await nextDocumentNo(tx, {
        schoolId,
        kind: "RECEIPT",
        year: Number(localDateString(at, timezone).slice(0, 4)),
        prefix: "RCPT",
      }),
      receivedAt: at,
      receiptIssuedAt: new Date(),
    },
  });
  await allocatePayment(tx, { schoolId, payment });
  return payment;
}

/**
 * Records one M-Pesa payment. Returns { status, duplicate, paymentId }.
 * studentId is given for STK pushes (we asked for the money for that learner).
 */
export async function recordMpesaPayment({ schoolId, transId, amount, billRef, msisdn, payerName, transTime, source = "C2B", studentId = null }) {
  const amt = Math.round(Number(amount) || 0);
  if (!transId || amt <= 0) return { status: "IGNORED", duplicate: false };

  const seen = await prisma.mpesaTransaction.findUnique({ where: { transId: String(transId) } });
  if (seen) return { status: seen.status, duplicate: true, paymentId: seen.paymentId };

  const matched = studentId || (await matchAdmission(schoolId, billRef));
  const { timezone } = await getSchoolCalendar(schoolId);
  const at = transTime instanceof Date && !Number.isNaN(transTime.getTime()) ? transTime : new Date();

  let result;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const payment = matched
          ? await postPayment(tx, { schoolId, studentId: matched, transId, amount: amt, msisdn, at, timezone })
          : null;
        await tx.mpesaTransaction.create({
          data: {
            schoolId,
            transId: String(transId),
            amount: amt,
            billRef: billRef ? String(billRef).slice(0, 40) : null,
            msisdn: msisdn ? String(msisdn).slice(0, 20) : null,
            payerName: payerName ? String(payerName).slice(0, 80) : null,
            transTime: at,
            source,
            status: payment ? "MATCHED" : "UNMATCHED",
            paymentId: payment?.id || null,
            studentId: matched || null,
          },
        });
        return { status: payment ? "MATCHED" : "UNMATCHED", paymentId: payment?.id || null };
      },
      { maxWait: 10_000, timeout: 20_000 }
    );
  } catch (err) {
    // Two notifications for one receipt arriving together: the second loses on the unique key.
    if (err?.code === "P2002") {
      const again = await prisma.mpesaTransaction.findUnique({ where: { transId: String(transId) } });
      return { status: again?.status || "MATCHED", duplicate: true, paymentId: again?.paymentId || null };
    }
    throw err;
  }

  await logAudit({
    schoolId,
    actorRole: "SYSTEM",
    action: result.paymentId ? "FEES_MPESA_PAYMENT_MATCHED" : "FEES_MPESA_PAYMENT_UNMATCHED",
    targetType: "MPESA",
    targetId: String(transId),
    metadata: { amount: amt, billRef, source },
  });
  if (result.paymentId) notifyPayment({ schoolId, paymentId: result.paymentId });
  return { ...result, duplicate: false };
}

/** Bursar puts an unmatched M-Pesa payment on a learner's account. */
export async function assignMpesaTransaction({ schoolId, id, studentId, actorId }) {
  const { timezone } = await getSchoolCalendar(schoolId);
  const out = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw`SELECT id FROM "MpesaTransaction" WHERE id = ${String(id)} AND "schoolId" = ${schoolId} FOR UPDATE`;
      if (!rows.length) throw Object.assign(new Error("M-Pesa payment not found."), { status: 404 });
      const t = await tx.mpesaTransaction.findUnique({ where: { id: rows[0].id } });
      if (t.status !== "UNMATCHED") throw Object.assign(new Error(`This payment is already ${t.status.toLowerCase()}.`), { status: 409 });
      const student = await tx.student.findFirst({ where: { id: String(studentId), schoolId }, select: { id: true } });
      if (!student) throw Object.assign(new Error("Student not found."), { status: 404 });

      const payment = await postPayment(tx, {
        schoolId,
        studentId: student.id,
        transId: t.transId,
        amount: t.amount,
        msisdn: t.msisdn,
        at: t.transTime || t.createdAt,
        timezone,
      });
      await tx.mpesaTransaction.update({
        where: { id: t.id },
        data: { status: "ASSIGNED", paymentId: payment.id, studentId: student.id, note: `Assigned by ${actorId || "staff"}` },
      });
      return { paymentId: payment.id, transId: t.transId };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
  notifyPayment({ schoolId, paymentId: out.paymentId, actorId });
  return out;
}
