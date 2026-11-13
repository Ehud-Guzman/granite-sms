// src/modules/privacy/privacy.js
// Data Protection Act tooling: removing a former learner's personal details,
// and the retention rules for logs.
//
// Anonymising keeps the school's records whole (invoices, payments, marks,
// attendance, published results) so totals and reports still add up, but
// nothing left identifies the child or their parents.
import { prisma } from "../../lib/prisma.js";

const httpError = (status, message) => Object.assign(new Error(message), { status });

export const ANON_FIRST = "Former";
export const ANON_LAST = "learner";

/** How long things are kept, in years (overridable by env for a school's own policy). */
export function retentionYears() {
  const n = (k, d) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v >= 1 ? v : d;
  };
  return {
    auditLogs: n("RETENTION_AUDIT_YEARS", 7),
    attendanceEdits: n("RETENTION_ATTENDANCE_EDIT_YEARS", 7),
    smsMessages: n("RETENTION_SMS_YEARS", 2),
    leavers: n("RETENTION_LEAVER_YEARS", 7),
  };
}

const yearsAgo = (years, now = new Date()) => {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
};

/**
 * Removes a former learner's personal details. Only for learners who have
 * left (inactive). Returns a summary of what was removed.
 */
export async function anonymiseStudent({ schoolId, studentId }) {
  return prisma.$transaction(
    async (tx) => {
      const st = await tx.student.findFirst({
        where: { id: String(studentId), schoolId },
        select: { id: true, isActive: true, anonymisedAt: true, userId: true },
      });
      if (!st) throw httpError(404, "Student not found.");
      if (st.isActive) throw httpError(400, "Only learners who have left can be anonymised. Record their exit first.");
      if (st.anonymisedAt) throw httpError(409, "This learner has already been anonymised.");

      const anonNo = `ANON-${st.id.slice(-8).toUpperCase()}`;

      // Parents: unlink, and remove anyone left with no other child here.
      const links = await tx.studentGuardian.findMany({ where: { schoolId, studentId: st.id }, select: { guardianId: true } });
      await tx.studentGuardian.deleteMany({ where: { schoolId, studentId: st.id } });
      let guardiansRemoved = 0;
      for (const { guardianId } of links) {
        const others = await tx.studentGuardian.count({ where: { guardianId } });
        if (others) continue;
        const g = await tx.guardian.delete({ where: { id: guardianId }, select: { userId: true } });
        if (g.userId) await tx.user.delete({ where: { id: g.userId } });
        guardiansRemoved += 1;
      }

      await tx.student.update({
        where: { id: st.id },
        data: {
          firstName: ANON_FIRST,
          lastName: ANON_LAST,
          admissionNo: anonNo,
          gender: null,
          dob: null,
          exitNote: null,
          consentBy: null,
          userId: null,
          anonymisedAt: new Date(),
        },
      });
      if (st.userId) await tx.user.delete({ where: { id: st.userId } });

      const results = await tx.studentResult.updateMany({
        where: { schoolId, studentId: st.id },
        data: { studentName: `${ANON_FIRST} ${ANON_LAST}`, admissionNo: anonNo },
      });
      await tx.reportCardComment.deleteMany({ where: { schoolId, studentId: st.id } });
      const sms = await tx.smsMessage.deleteMany({ where: { schoolId, studentId: st.id } });
      await tx.mpesaTransaction.updateMany({
        where: { schoolId, studentId: st.id },
        data: { msisdn: null, payerName: null, billRef: anonNo },
      });
      await tx.mpesaStkRequest.updateMany({ where: { schoolId, studentId: st.id }, data: { phone: "removed" } });
      // Older audit entries about this learner may carry their name or details.
      await tx.auditLog.updateMany({ where: { schoolId, targetType: "STUDENT", targetId: st.id }, data: { metadata: { anonymised: true } } });

      return { admissionNo: anonNo, guardiansRemoved, resultsUpdated: results.count, smsRemoved: sms.count };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}

/**
 * Applies the retention rules. With write=false (the default) it only counts
 * what would go. Leavers past their retention are anonymised only when
 * anonymiseLeavers is also set.
 */
export async function applyRetention({ write = false, anonymiseLeavers = false, now = new Date(), schoolId = null } = {}) {
  const y = retentionYears();
  const scope = schoolId ? { schoolId } : {};
  const auditWhere = { ...scope, createdAt: { lt: yearsAgo(y.auditLogs, now) } };
  const editWhere = { ...scope, createdAt: { lt: yearsAgo(y.attendanceEdits, now) } };
  // Only messages that are finished with (not still queued).
  const smsWhere = { ...scope, createdAt: { lt: yearsAgo(y.smsMessages, now) }, status: { not: "QUEUED" } };
  const leaverWhere = { ...scope, isActive: false, anonymisedAt: null, exitDate: { lt: yearsAgo(y.leavers, now) } };

  const [auditLogs, attendanceEdits, smsMessages, leavers] = await Promise.all([
    prisma.auditLog.count({ where: auditWhere }),
    prisma.attendanceEditLog.count({ where: editWhere }),
    prisma.smsMessage.count({ where: smsWhere }),
    prisma.student.findMany({ where: leaverWhere, select: { id: true, schoolId: true } }),
  ]);
  const report = { years: y, auditLogs, attendanceEdits, smsMessages, leaversDue: leavers.length, leaversAnonymised: 0, write };
  if (!write) return report;

  await prisma.auditLog.deleteMany({ where: auditWhere });
  await prisma.attendanceEditLog.deleteMany({ where: editWhere });
  await prisma.smsMessage.deleteMany({ where: smsWhere });
  if (anonymiseLeavers) {
    for (const l of leavers) {
      await anonymiseStudent({ schoolId: l.schoolId, studentId: l.id });
      report.leaversAnonymised += 1;
    }
  }
  return report;
}
