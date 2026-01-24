// src/modules/attendance/attendance.service.js

import { prisma } from "../../lib/prisma.js";
import { AttendanceSessionStatus } from "@prisma/client";
import { ensureEditable } from "./attendance.validators.js";

/**
 * Determine if a teacher (by userId) is allowed to take attendance for a class.
 * - Primary: must be class teacher
 * - Fallback: must have active teaching assignment for that class
 * - Admin bypass is handled in controller
 */
async function teacherCanAccessClass({ schoolId, userId, classId }) {
  // tenant safety: teacher table is per school in your design? (if not, still ok)
  const teacher = await prisma.teacher.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!teacher) return false;

  // Primary: class teacher
  const isClassTeacher = await prisma.classTeacher.findFirst({
    where: { classId, teacherId: teacher.id, isActive: true },
    select: { id: true },
  });
  if (isClassTeacher) return true;

  // Secondary: teaching assignment
  const isAssigned = await prisma.teachingAssignment.findFirst({
    where: { classId, teacherId: teacher.id, isActive: true },
    select: { id: true },
  });

  return Boolean(isAssigned);
}

export async function assertTeacherAccessOrThrow({ schoolId, userId, classId }) {
  const ok = await teacherCanAccessClass({ schoolId, userId, classId });
  if (!ok) {
    const err = new Error("Teacher not authorized for this class.");
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Create or reopen a session (upsert) and ensure records exist for all active students
 */
export async function upsertSessionAndEnsureRecords({
  schoolId,
  classId,
  date,
  year,
  term,
  takenByUserId,
  role,
}) {
  const session = await prisma.attendanceSession.upsert({
    where: { schoolId_classId_date: { schoolId, classId, date } },
    create: {
      schoolId,
      classId,
      date,
      year,
      term,
      takenByUserId,
      status: AttendanceSessionStatus.DRAFT,
    },
    update: {
      year,
      term,
      takenByUserId: takenByUserId || undefined,
    },
  });

  const students = await prisma.student.findMany({
    where: { classId, isActive: true },
    select: { id: true },
  });

  if (students.length === 0) return { session, createdRecords: 0 };

  const data = students.map((s) => ({
    schoolId,
    sessionId: session.id,
    studentId: s.id,
    status: "PRESENT",
  }));

  const result = await prisma.attendanceRecord.createMany({
    data,
    skipDuplicates: true,
  });

  return { session, createdRecords: result.count };
}

export async function getSessionWithRecords({ schoolId, sessionId }) {
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: { records: true },
  });

  if (!session) {
    const err = new Error("Attendance session not found.");
    err.statusCode = 404;
    throw err;
  }
  return session;
}

// ---------- Optimized bulk update ----------

function normalizeNext(r) {
  const status = r.status;
  const minutesLate = status === "LATE" ? (r.minutesLate ?? 0) : null;
  const comment = r.comment ?? null;
  return { status, minutesLate, comment };
}

function isSame(existing, next) {
  return (
    existing.status === next.status &&
    (existing.minutesLate ?? null) === (next.minutesLate ?? null) &&
    (existing.comment ?? null) === (next.comment ?? null)
  );
}

export async function bulkUpdateRecords({ schoolId, sessionId, editorUserId, records }) {
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: { records: false },
  });

  if (!session) {
    const err = new Error("Attendance session not found.");
    err.statusCode = 404;
    throw err;
  }

  ensureEditable(session);

  const studentIds = records.map((r) => r.studentId);

  await prisma.$transaction(
    async (tx) => {
      const existingRecords = await tx.attendanceRecord.findMany({
        where: { schoolId, sessionId, studentId: { in: studentIds } },
        select: { id: true, studentId: true, status: true, minutesLate: true, comment: true },
      });

      const byStudentId = new Map(existingRecords.map((x) => [x.studentId, x]));
      const CHUNK = 40;

      for (let i = 0; i < records.length; i += CHUNK) {
        const batch = records.slice(i, i + CHUNK);

        await Promise.all(
          batch.map(async (r) => {
            const next = normalizeNext(r);
            const existing = byStudentId.get(r.studentId);

            // CREATE (new student added after session creation)
            if (!existing) {
              const created = await tx.attendanceRecord.create({
                data: {
                  schoolId,
                  sessionId,
                  studentId: r.studentId,
                  status: next.status,
                  minutesLate: next.minutesLate,
                  comment: next.comment,
                },
                select: { id: true },
              });

              await tx.attendanceEditLog.create({
                data: {
                  schoolId,
                  sessionId,
                  recordId: created.id,
                  editedByUserId: editorUserId,
                  action: "CREATE_RECORD",
                  before: null,
                  after: next,
                },
              });

              byStudentId.set(r.studentId, {
                id: created.id,
                studentId: r.studentId,
                status: next.status,
                minutesLate: next.minutesLate,
                comment: next.comment,
              });

              return;
            }

            // skip no-op
            if (isSame(existing, next)) return;

            await tx.attendanceRecord.update({
              where: { id: existing.id },
              data: {
                status: next.status,
                minutesLate: next.minutesLate,
                comment: next.comment,
              },
            });

            await tx.attendanceEditLog.create({
              data: {
                schoolId,
                sessionId,
                recordId: existing.id,
                editedByUserId: editorUserId,
                action: "UPDATE_RECORD",
                before: {
                  status: existing.status,
                  minutesLate: existing.minutesLate,
                  comment: existing.comment,
                },
                after: next,
              },
            });

            existing.status = next.status;
            existing.minutesLate = next.minutesLate;
            existing.comment = next.comment;
          })
        );
      }
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  return prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: { records: true },
  });
}

// ---------- Session lifecycle ----------

export async function submitSession({ schoolId, sessionId, editorUserId }) {
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: { records: false },
  });

  if (!session) {
    const err = new Error("Attendance session not found.");
    err.statusCode = 404;
    throw err;
  }

  // block submit if already submitted/locked (admin unlock route exists)
  ensureEditable(session);

  const activeCount = await prisma.student.count({
    where: { classId: session.classId, isActive: true },
  });

  const recordCount = await prisma.attendanceRecord.count({
    where: { schoolId, sessionId },
  });

  if (activeCount > 0 && recordCount < activeCount) {
    const err = new Error(
      "Session incomplete: missing some student records. Reopen session to auto-generate."
    );
    err.statusCode = 409;
    throw err;
  }

  const updated = await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: {
      status: AttendanceSessionStatus.SUBMITTED,
      submittedAt: new Date(),
    },
  });

  await prisma.attendanceEditLog.create({
    data: {
      schoolId,
      sessionId,
      editedByUserId: editorUserId,
      action: "SUBMIT_SESSION",
      before: { status: session.status },
      after: { status: updated.status },
    },
  });

  return updated;
}

export async function unlockSession({ schoolId, sessionId, editorUserId }) {
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
  });

  if (!session) {
    const err = new Error("Attendance session not found.");
    err.statusCode = 404;
    throw err;
  }

  const updated = await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: { status: AttendanceSessionStatus.DRAFT, lockedAt: null },
  });

  await prisma.attendanceEditLog.create({
    data: {
      schoolId,
      sessionId,
      editedByUserId: editorUserId,
      action: "UNLOCK_SESSION",
      before: { status: session.status },
      after: { status: updated.status },
    },
  });

  return updated;
}

export async function lockSession({ schoolId, sessionId, editorUserId }) {
  const session = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
  });

  if (!session) {
    const err = new Error("Attendance session not found.");
    err.statusCode = 404;
    throw err;
  }

  const updated = await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: { status: AttendanceSessionStatus.LOCKED, lockedAt: new Date() },
  });

  await prisma.attendanceEditLog.create({
    data: {
      schoolId,
      sessionId,
      editedByUserId: editorUserId,
      action: "LOCK_SESSION",
      before: { status: session.status },
      after: { status: updated.status },
    },
  });

  return updated;
}

export async function listSessions({ schoolId, classId, from, to }) {
  return prisma.attendanceSession.findMany({
    where: {
      schoolId,
      classId: classId || undefined,
      date: { gte: from || undefined, lte: to || undefined },
    },
    orderBy: { date: "desc" },
  });
}

export async function summaryStudent({ schoolId, studentId, from, to }) {
  const where = {
    schoolId,
    studentId,
    session: { date: { gte: from || undefined, lte: to || undefined } },
  };

  const total = await prisma.attendanceRecord.count({ where });
  const present = await prisma.attendanceRecord.count({ where: { ...where, status: "PRESENT" } });
  const absent = await prisma.attendanceRecord.count({ where: { ...where, status: "ABSENT" } });
  const late = await prisma.attendanceRecord.count({ where: { ...where, status: "LATE" } });
  const excused = await prisma.attendanceRecord.count({ where: { ...where, status: "EXCUSED" } });

  const rate = total > 0 ? Math.round((present / total) * 100) : 0;

  return { studentId, total, present, absent, late, excused, attendanceRatePct: rate };
}

export async function summaryClass({ schoolId, classId, from, to }) {
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      schoolId,
      classId,
      date: { gte: from || undefined, lte: to || undefined },
    },
    select: { id: true, date: true },
    orderBy: { date: "asc" },
  });

  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return { classId, days: [] };

  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId, sessionId: { in: sessionIds } },
    select: { sessionId: true, status: true },
  });

  const map = new Map();
  for (const s of sessions) {
    map.set(s.id, { date: s.date, present: 0, absent: 0, late: 0, excused: 0, total: 0 });
  }

  for (const r of records) {
    const row = map.get(r.sessionId);
    if (!row) continue;
    row.total += 1;
    if (r.status === "PRESENT") row.present += 1;
    if (r.status === "ABSENT") row.absent += 1;
    if (r.status === "LATE") row.late += 1;
    if (r.status === "EXCUSED") row.excused += 1;
  }

  const days = Array.from(map.values()).map((d) => ({
    ...d,
    attendanceRatePct: d.total > 0 ? Math.round((d.present / d.total) * 100) : 0,
  }));

  return { classId, days };
}

export async function defaulters({ schoolId, classId, from, to, minAbsences = 5 }) {
  const students = await prisma.student.findMany({
    where: { classId, isActive: true },
    select: { id: true, admissionNo: true, firstName: true, lastName: true },
  });

  if (students.length === 0) return [];

  const records = await prisma.attendanceRecord.findMany({
    where: {
      schoolId,
      studentId: { in: students.map((s) => s.id) },
      status: "ABSENT",
      session: { date: { gte: from || undefined, lte: to || undefined } },
    },
    select: { studentId: true },
  });

  const counts = new Map();
  for (const r of records) counts.set(r.studentId, (counts.get(r.studentId) || 0) + 1);

  return students
    .map((s) => ({
      studentId: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      absences: counts.get(s.id) || 0,
    }))
    .filter((x) => x.absences >= Number(minAbsences))
    .sort((a, b) => b.absences - a.absences);
}
