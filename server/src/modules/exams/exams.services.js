// src/modules/exams/exams.services.js
import { MarkSheetStatus, ExamSessionStatus, ExamAuditAction } from "@prisma/client";
import {
  assertCuid,
  assertInt,
  assertTerm,
  assertMarkSheetEditable,
  validateBulkMarksPayload,
} from "./exams.validators.js";
import { buildAuditPayload } from "./exams.utils.js";
import { examTypeSelect, examSessionSelect, markSheetSelect } from "./exams.selectors.js";
import { gradeFromScore, DEFAULT_GRADE_BANDS } from "./exams.grades.js";
import { prisma } from "../../lib/prisma.js";
import { cleanStr } from "../../utils/validate.js";

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
async function audit(schoolId, data) {
  return prisma.examAuditLog.create({ data: { schoolId, ...data } });
}

async function getTeacherIdFromReq(req) {
  return req.user?.teacherId || req.user?.teacher?.id || null;
}

// Class-level access gate for TEACHER role, mirroring
// attendance.service.js's assertTeacherAccessOrThrow: a teacher may act on a
// class only if they're its ClassTeacher or hold an active TeachingAssignment
// for it. Used for endpoints (class results, student results, session
// listing) that aren't already scoped by a per-subject MarkSheet.teacherId.
async function assertTeacherClassAccess({ schoolId, teacherId, classId }) {
  if (!teacherId) {
    throw Object.assign(new Error("Teacher profile not linked to user."), { statusCode: 403 });
  }
  const [isClassTeacher, isAssigned] = await Promise.all([
    prisma.classTeacher.findFirst({
      where: { schoolId, classId, teacherId, isActive: true },
      select: { id: true },
    }),
    prisma.teachingAssignment.findFirst({
      where: { schoolId, classId, teacherId, isActive: true },
      select: { id: true },
    }),
  ]);
  if (!isClassTeacher && !isAssigned) {
    throw Object.assign(new Error("Teacher not authorized for this class."), { statusCode: 403 });
  }
}

// All classIds a teacher currently has some claim to (class-teacher OR
// active teaching assignment), tenant-scoped. Used to scope list-style
// endpoints for TEACHER callers that don't pass an explicit classId.
async function getTeacherAssignedClassIds({ schoolId, teacherId }) {
  if (!teacherId) return [];
  const [classTeacherRows, assignmentRows] = await Promise.all([
    prisma.classTeacher.findMany({
      where: { schoolId, teacherId, isActive: true },
      select: { classId: true },
    }),
    prisma.teachingAssignment.findMany({
      where: { schoolId, teacherId, isActive: true },
      select: { classId: true },
    }),
  ]);
  return [
    ...new Set([
      ...classTeacherRows.map((r) => r.classId),
      ...assignmentRows.map((r) => r.classId),
    ]),
  ];
}

// Backfill Mark rows for every markSheet in a session so a student who
// joined the class after the marksheets/session were created (and whose
// marksheet hasn't been individually opened/edited/submitted since) still
// shows up in class/student results instead of being silently omitted.
async function ensureMarkRowsForSession({ schoolId, sessionId, classId }) {
  const sheets = await prisma.markSheet.findMany({
    where: { schoolId, examSessionId: sessionId },
    select: { id: true },
  });
  await Promise.all(
    sheets.map((ms) => ensureMarkRowsForCurrentStudents({ schoolId, markSheetId: ms.id, classId }))
  );
}

// Shared by getClassResults and getStudentResults so total/average/grade
// math is computed in exactly one place.
function summarizeSubjectScores(subjectScores) {
  const validScores = subjectScores.filter((s) => s.score != null).map((s) => Number(s.score));
  const total = validScores.reduce((a, b) => a + b, 0);
  const average = validScores.length ? total / validScores.length : 0;

  return {
    total,
    average: Number(average.toFixed(2)),
    overallGrade: validScores.length ? gradeFromScore(Math.round(average)) : null,
    missingCount: subjectScores.filter((s) => s.score == null).length,
  };
}

async function assertMarkSheetAccess(req, markSheet, { allowClaim = false } = {}) {
  if (req.user.role === "ADMIN") return;

  const teacherId = await getTeacherIdFromReq(req);
  if (!teacherId) {
    throw Object.assign(new Error("Teacher profile not linked to user."), { statusCode: 403 });
  }

  if (markSheet.teacherId === teacherId) return;

  if (allowClaim && markSheet.teacherId === null) return;

  throw Object.assign(new Error("Access denied: not your marksheet."), { statusCode: 403 });
}

async function claimMarkSheetIfUnassigned({ schoolId, markSheetId, teacherId }) {
  const res = await prisma.markSheet.updateMany({
    where: { id: markSheetId, schoolId, teacherId: null },
    data: { teacherId },
  });
  return res.count === 1;
}

async function ensureMarkRowsForCurrentStudents({ schoolId, markSheetId, classId }) {
  const students = await prisma.student.findMany({
    where: { schoolId, classId, isActive: true },
    select: { id: true },
  });
  if (!students.length) return { added: 0 };

  const existing = await prisma.mark.findMany({
    where: { schoolId, markSheetId },
    select: { studentId: true },
  });
  const existingSet = new Set(existing.map((m) => m.studentId));
  const missing = students.filter((s) => !existingSet.has(s.id));

  if (!missing.length) return { added: 0 };

  await prisma.mark.createMany({
    data: missing.map((s) => ({
      schoolId,
      markSheetId,
      studentId: s.id,
      score: null,
      isMissing: true,
      comment: null,
    })),
    skipDuplicates: true,
  });

  return { added: missing.length };
}

// Optional: clean up marks belonging to deactivated students
// (helps prevent accumulation of orphaned data)
async function cleanupDeactivatedMarks({ schoolId, markSheetId }) {
  const deleted = await prisma.mark.deleteMany({
    where: {
      schoolId,
      markSheetId,
      student: { isActive: false },
    },
  });
  return deleted.count;
}

// ────────────────────────────────────────────────
// Exam Types
// ────────────────────────────────────────────────

export async function listExamSessions(req) {
  const schoolId = req.user.schoolId;
  const { year, term: termRaw, classId, status } = req.query;

  const where = { schoolId };

  if (year) {
    where.year = assertInt("year", year);
  }

  let termFilter;
  if (termRaw) {
    const termStr = String(termRaw).trim().toLowerCase();
    if (termStr === 'all') {
      termFilter = undefined; // all terms
    } else {
      termFilter = assertTerm(termStr); // validate real term
    }
  } else {
    termFilter = undefined; // missing term = all terms
  }

  if (termFilter) {
    where.term = termFilter;
  }

  if (classId) where.classId = String(classId);

  if (status) {
    const statusStr = String(status).trim().toUpperCase();
    if (!Object.values(ExamSessionStatus).includes(statusStr)) {
      throw Object.assign(
        new Error(`Invalid status. Allowed: ${Object.values(ExamSessionStatus).join(", ")}`),
        { statusCode: 400 }
      );
    }
    where.status = statusStr;
  }

  // Teachers may only list sessions for classes they're actually assigned to
  // (ClassTeacher or active TeachingAssignment) — same gap class as the
  // attendance module's listSessions, fixed the same way: with an explicit
  // classId, verify access; without one, scope to their assigned classes
  // instead of returning every class in the school.
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    if (where.classId) {
      await assertTeacherClassAccess({ schoolId, teacherId, classId: where.classId });
    } else {
      const assignedClassIds = await getTeacherAssignedClassIds({ schoolId, teacherId });
      where.classId = { in: assignedClassIds };
    }
  }

  return prisma.examSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: examSessionSelect,
  });
}

export async function listExamTypes(req) {
  const schoolId = req.user.schoolId;
  return prisma.examType.findMany({
    where: { schoolId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: examTypeSelect,
  });
}

export async function createExamType(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;

  const name = cleanStr(req.body?.name);
  if (!name) throw Object.assign(new Error("Name is required."), { statusCode: 400 });

  const code = cleanStr(req.body?.code || "");
  const weight = req.body?.weight != null ? Number(req.body.weight) : null;
  if (weight != null && (Number.isNaN(weight) || weight <= 0 || weight > 1)) {
    throw Object.assign(new Error("Weight must be between 0 and 1."), { statusCode: 400 });
  }

  let created;
  try {
    created = await prisma.examType.create({
      data: { schoolId, name, code: code || null, weight, isActive: true },
      select: examTypeSelect,
    });
  } catch (e) {
    if (e?.code === "P2002") {
      throw Object.assign(new Error("An exam type with this name already exists."), { statusCode: 409 });
    }
    throw e;
  }

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.CREATE,
    entityType: "ExamType",
    entityId: created.id,
    actorUserId,
    after: created,
  }));

  return created;
}

// ────────────────────────────────────────────────
// Exam Sessions
// ────────────────────────────────────────────────
export async function createExamSession(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;

  const year = assertInt("year", req.body?.year);
  const term = req.body?.term;
  assertTerm(term);

  const classId = assertCuid("classId", req.body?.classId);
  const examTypeId = assertCuid("examTypeId", req.body?.examTypeId);
  const name = cleanStr(req.body?.name || "");

  const [classRow, typeRow] = await Promise.all([
    prisma.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } }),
    prisma.examType.findFirst({ where: { id: examTypeId, schoolId, isActive: true }, select: { id: true } }),
  ]);

  if (!classRow) throw Object.assign(new Error("Invalid class."), { statusCode: 400 });
  if (!typeRow) throw Object.assign(new Error("Invalid or inactive exam type."), { statusCode: 400 });

  // No DB-level unique constraint exists for (schoolId, classId, year, term,
  // examTypeId), so guard against accidental duplicate sessions here — a
  // second identical session would fork marksheets/results for the same
  // class/term/exam type and confuse everything downstream.
  const dup = await prisma.examSession.findFirst({
    where: { schoolId, classId, year, term, examTypeId },
    select: { id: true },
  });
  if (dup) {
    throw Object.assign(
      new Error("An exam session for this class/term/year/exam type already exists."),
      { statusCode: 409 }
    );
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.examSession.create({
      data: {
        schoolId,
        year,
        term,
        classId,
        examTypeId,
        name: name || null,
        createdByUserId: actorUserId,
        status: ExamSessionStatus.DRAFT,
      },
      select: examSessionSelect,
    });

    await audit(schoolId, buildAuditPayload({
      action: ExamAuditAction.CREATE,
      entityType: "ExamSession",
      entityId: session.id,
      actorUserId,
      after: session,
    }));

    // Teaching assignments → marksheets
    const assignments = await tx.teachingAssignment.findMany({
      where: { schoolId, classId, isActive: true },
      select: { teacherId: true, subjectId: true },
    });

    if (!assignments.length) {
      throw Object.assign(
        new Error(
          "No teaching assignments found for this class. Set up subjects and teacher assignments in Settings > Curriculum before creating an exam session."
        ),
        { statusCode: 400 }
      );
    }

    const map = new Map(assignments.map(a => [a.subjectId, a.teacherId]));
    const subjectsData = Array.from(map, ([subjectId, teacherId]) => ({
      schoolId,
      examSessionId: session.id,
      subjectId,
      teacherId,
      status: MarkSheetStatus.DRAFT,
    }));

    if (subjectsData.length) {
      await tx.markSheet.createMany({ data: subjectsData, skipDuplicates: true });
    }

    const sheets = await tx.markSheet.findMany({
      where: { schoolId, examSessionId: session.id },
      select: { id: true },
    });

    const students = await tx.student.findMany({
      where: { schoolId, classId, isActive: true },
      select: { id: true },
    });

    const markRows = sheets.flatMap(ms =>
      students.map(st => ({
        schoolId,
        markSheetId: ms.id,
        studentId: st.id,
        score: null,
        isMissing: true,
        comment: null,
      }))
    );

    if (markRows.length) {
      await tx.mark.createMany({ data: markRows, skipDuplicates: true });
    }

    return session;
  });
}

// ────────────────────────────────────────────────
// MarkSheets
// ────────────────────────────────────────────────
export async function getMarkSheet(req) {
  const schoolId = req.user.schoolId;
  const id = assertCuid("markSheetId", req.params?.id);

  const ms = await prisma.markSheet.findFirst({
    where: { id, schoolId },
    select: {
      ...markSheetSelect,
      teacherId: true,
      status: true,
      examSession: { select: { id: true, status: true, year: true, term: true, classId: true, name: true } },
    },
  });

  if (!ms) throw Object.assign(new Error("Marksheet not found."), { statusCode: 404 });

  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    if (!teacherId) throw Object.assign(new Error("Teacher profile not linked."), { statusCode: 403 });
    if (ms.teacherId !== null && ms.teacherId !== teacherId) {
      throw Object.assign(new Error("Not your marksheet."), { statusCode: 403 });
    }
  } else {
    await assertMarkSheetAccess(req, ms);
  }

  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId: ms.id,
    classId: ms.examSession.classId,
  });

  return prisma.markSheet.findFirst({
    where: { id, schoolId },
    select: {
      ...markSheetSelect,
      examSession: { select: { id: true, status: true, year: true, term: true, classId: true, name: true } },
      marks: {
        where: { student: { isActive: true } },
        select: {
          id: true,
          studentId: true,
          score: true,
          isMissing: true,
          comment: true,
          updatedAt: true,
          student: {
            select: {
              id: true,
              admissionNo: true,
              firstName: true,
              lastName: true,
              gender: true,
            },
          },
        },
        orderBy: [{ student: { admissionNo: "asc" } }],
      },
    },
  });
}

export async function upsertBulkMarks(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const markSheetId = assertCuid("markSheetId", req.params?.id);

  const marks = validateBulkMarksPayload(req.body);

  if (marks.length > 300) {
    throw Object.assign(new Error("Maximum 300 marks per request allowed."), { statusCode: 400 });
  }

  const ms = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: {
      id: true,
      status: true,
      teacherId: true,
      examSession: { select: { id: true, status: true, classId: true } },
    },
  });

  if (!ms) throw Object.assign(new Error("Marksheet not found."), { statusCode: 404 });

  await assertMarkSheetAccess(req, ms, { allowClaim: true });

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("Cannot edit marks after session is published."), { statusCode: 403 });
  }

  assertMarkSheetEditable(ms.status);

  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId,
    classId: ms.examSession.classId,
  });

  // Auto-claim for teachers
  if (req.user.role === "TEACHER" && ms.teacherId === null) {
    const teacherId = await getTeacherIdFromReq(req);
    const claimed = await claimMarkSheetIfUnassigned({ schoolId, markSheetId, teacherId });
    if (!claimed) {
      const fresh = await prisma.markSheet.findFirst({
        where: { id: markSheetId, schoolId },
        select: { teacherId: true },
      });
      if (fresh?.teacherId !== teacherId) {
        throw Object.assign(new Error("Marksheet already claimed by another teacher."), { statusCode: 403 });
      }
    }
  }

  const allowedStudents = await prisma.student.findMany({
    where: { schoolId, classId: ms.examSession.classId, isActive: true },
    select: { id: true },
  });
  const allowedSet = new Set(allowedStudents.map(s => s.id));

  const tx = [];
  const skipped = [];

  for (const row of marks) {
    const studentId = String(row.studentId);
    if (!allowedSet.has(studentId)) {
      skipped.push(studentId);
      continue;
    }

    let score = row.score;
    if (score === "" || score == null) {
      score = null;
    } else {
      score = Number(score);
      if (Number.isNaN(score) || score < 0 || score > 100) {
        throw Object.assign(
          new Error(`Invalid score for student ${studentId}: must be 0–100 or empty.`),
          { statusCode: 400 }
        );
      }
    }

    tx.push(
      prisma.mark.upsert({
        where: { schoolId_markSheetId_studentId: { schoolId, markSheetId, studentId } },
        create: {
          schoolId,
          markSheetId,
          studentId,
          score,
          isMissing: score === null,
          comment: cleanStr(row.comment) || null,
        },
        update: {
          score,
          isMissing: score === null,
          comment: cleanStr(row.comment) || null,
        },
        select: { id: true, studentId: true, score: true, isMissing: true, updatedAt: true },
      })
    );
  }

  const updated = await prisma.$transaction(tx);

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.UPDATE,
    entityType: "Mark",
    entityId: markSheetId,
    actorUserId,
    after: { updatedCount: updated.length, skippedCount: skipped.length },
  }));

  // Counts only active students
  const [missingCount, filledCount] = await Promise.all([
    prisma.mark.count({
      where: { schoolId, markSheetId, isMissing: true, student: { isActive: true } },
    }),
    prisma.mark.count({
      where: { schoolId, markSheetId, isMissing: false, student: { isActive: true } },
    }),
  ]);

  return {
    markSheetId,
    updatedCount: updated.length,
    skipped,
    missingCount,
    filledCount,
    totalActiveStudents: missingCount + filledCount,
    status: ms.status,
  };
}

export async function submitMarkSheet(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const markSheetId = assertCuid("markSheetId", req.params?.id);

  const ms = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: {
      id: true,
      status: true,
      teacherId: true,
      examSession: { select: { status: true, classId: true } },
    },
  });

  if (!ms) throw Object.assign(new Error("Marksheet not found."), { statusCode: 404 });

  await assertMarkSheetAccess(req, ms);

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("Cannot submit after results are published."), { statusCode: 403 });
  }

  // A marksheet that's already SUBMITTED must go through unlock before it
  // can be (re-)submitted — otherwise re-POSTing this endpoint silently
  // resets submittedAt/submittedById with no real state transition, and
  // bypasses the DRAFT/UNLOCKED precondition every other write path enforces.
  assertMarkSheetEditable(ms.status);

  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId,
    classId: ms.examSession.classId,
  });

  // Optional but recommended: clean orphaned deactivated marks before final check
  await cleanupDeactivatedMarks({ schoolId, markSheetId });

  const missing = await prisma.mark.count({
    where: {
      schoolId,
      markSheetId,
      isMissing: true,
      student: { isActive: true },
    },
  });

  if (missing > 0) {
    throw Object.assign(
      new Error(`Cannot submit: ${missing} active student(s) still have missing marks.`),
      { statusCode: 400 }
    );
  }

  await prisma.markSheet.updateMany({
    where: { id: markSheetId, schoolId },
    data: {
      status: MarkSheetStatus.SUBMITTED,
      submittedAt: new Date(),
      submittedById: actorUserId,
    },
  });

  const updated = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: markSheetSelect,
  });

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.SUBMIT,
    entityType: "MarkSheet",
    entityId: markSheetId,
    actorUserId,
    before: { status: ms.status },
    after: { status: updated.status, submittedAt: updated.submittedAt },
  }));

  return updated;
}

export async function unlockMarkSheet(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const markSheetId = assertCuid("markSheetId", req.params?.id);
  const reason = cleanStr(req.body?.reason);

  if (!reason) throw Object.assign(new Error("Unlock reason is required."), { statusCode: 400 });

  const ms = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: { id: true, status: true, examSession: { select: { status: true } } },
  });

  if (!ms) throw Object.assign(new Error("Marksheet not found."), { statusCode: 404 });

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("Cannot unlock after results published."), { statusCode: 403 });
  }

  if (ms.status !== MarkSheetStatus.SUBMITTED) {
    throw Object.assign(new Error("Only submitted marksheets can be unlocked."), { statusCode: 400 });
  }

  await prisma.markSheet.updateMany({
    where: { id: markSheetId, schoolId },
    data: {
      status: MarkSheetStatus.UNLOCKED,
      unlockedAt: new Date(),
      unlockedById: actorUserId,
      unlockReason: reason,
    },
  });

  const updated = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: markSheetSelect,
  });

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.UNLOCK,
    entityType: "MarkSheet",
    entityId: markSheetId,
    actorUserId,
    before: { status: ms.status },
    after: { status: updated.status, unlockReason: reason },
  }));

  return updated;
}

export async function listSessionMarkSheets(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, status: true, classId: true, year: true, term: true, name: true },
  });

  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });

  const where = { schoolId, examSessionId: sessionId };
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    if (!teacherId) throw Object.assign(new Error("Teacher profile not linked."), { statusCode: 403 });
    where.OR = [{ teacherId }, { teacherId: null }];
  }

  const markSheets = await prisma.markSheet.findMany({
    where,
    orderBy: [{ subject: { name: "asc" } }],
    select: markSheetSelect,
  });

  const ids = markSheets.map(m => m.id);
  const missingMap = new Map();

  if (ids.length) {
    const missing = await prisma.mark.groupBy({
      by: ["markSheetId"],
      where: {
        schoolId,
        markSheetId: { in: ids },
        isMissing: true,
        student: { isActive: true },
      },
      _count: { _all: true },
    });

    for (const row of missing) {
      missingMap.set(row.markSheetId, row._count._all);
    }
  }

  return {
    session,
    markSheets: markSheets.map(m => ({
      ...m,
      missingCount: missingMap.get(m.id) ?? 0,
    })),
  };
}

// ────────────────────────────────────────────────
// Results
// ────────────────────────────────────────────────
/**
 * Canonical results engine for a session: fetches marks once and computes
 * total/average/grade/position in exactly one place. Both the class results
 * screen and the class-performance report consume this — no re-derivation
 * elsewhere (previously duplicated, and drifted, in three separate places:
 * this file, reports.services.js, and the client table component).
 *
 * Shape:
 * {
 *   session: { id, classId, term, year },
 *   subjects: [{ id, name }],
 *   results: [{
 *     student: { id, admissionNo, firstName, lastName },
 *     subjectScores: [{ subjectId, subjectName, score }],
 *     total, average, overallGrade, missingCount, position
 *   }]
 * }
 */
export async function getClassResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, classId: true, term: true, year: true, name: true, status: true },
  });

  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });

  // TEACHER callers may only view results for classes they actually teach
  // (class-teacher or active teaching assignment) — previously any teacher
  // could pull the full class report card for any class in the school.
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    await assertTeacherClassAccess({ schoolId, teacherId, classId: session.classId });
  }

  // Backfill mark rows for currently-active students so a student added to
  // the class after the marksheets were created (and never re-opened since)
  // isn't silently dropped from the results/ranking entirely.
  await ensureMarkRowsForSession({ schoolId, sessionId, classId: session.classId });

  const marks = await prisma.mark.findMany({
    where: {
      schoolId,
      markSheet: { examSessionId: sessionId },
      student: { isActive: true },
    },
    select: {
      studentId: true,
      score: true,
      student: {
        select: { id: true, admissionNo: true, firstName: true, lastName: true },
      },
      markSheet: {
        select: {
          subjectId: true,
          subject: { select: { id: true, name: true } },
        },
      },
    },
  });

  const subjectsById = new Map();
  const byStudent = new Map();

  for (const m of marks) {
    const subjectId = m.markSheet.subjectId;
    if (!subjectsById.has(subjectId)) {
      subjectsById.set(subjectId, {
        id: subjectId,
        name: m.markSheet.subject?.name || "NO_SUBJECT_NAME",
      });
    }

    if (!byStudent.has(m.studentId)) {
      byStudent.set(m.studentId, { student: m.student, subjectScores: [] });
    }

    byStudent.get(m.studentId).subjectScores.push({
      subjectId,
      subjectName: m.markSheet.subject?.name || "NO_SUBJECT_NAME",
      score: m.score,
    });
  }

  const results = Array.from(byStudent.values()).map(({ student, subjectScores }) => ({
    student,
    subjectScores,
    ...summarizeSubjectScores(subjectScores),
  }));

  // Ranking: dense-ish (ties share a position)
  results.sort((a, b) => b.total - a.total || b.average - a.average);
  let position = 0;
  let prevTotal = null;
  let prevAvg = null;
  results.forEach((r, idx) => {
    if (prevTotal === null || r.total !== prevTotal || r.average !== prevAvg) {
      position = idx + 1;
      prevTotal = r.total;
      prevAvg = r.average;
    }
    r.position = position;
  });

  return {
    session,
    subjects: Array.from(subjectsById.values()),
    results,
  };
}

/**
 * A single student's results for one exam session (the "student slip").
 * Route: GET /sessions/:id/results/students/:studentId
 * - :id is the exam session id (NOT the student id — this was previously
 *   misread as the student id, which meant this endpoint always returned
 *   an empty result set in production).
 * - STUDENT-role callers may only fetch their own record (enforced here,
 *   not just at the router role-gate, to close an IDOR: nothing previously
 *   stopped a STUDENT token from passing any studentId in the URL).
 */
export async function getStudentResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);
  const studentId = assertCuid("studentId", req.params?.studentId);

  if (req.user.role === "STUDENT" && req.user.studentId !== studentId) {
    throw Object.assign(
      new Error("Students can only view their own results."),
      { statusCode: 403 }
    );
  }

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, classId: true, term: true, year: true, name: true, status: true },
  });
  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, classId: true },
  });
  if (!student) throw Object.assign(new Error("Student not found."), { statusCode: 404 });

  // TEACHER callers may only view results for students in classes they
  // actually teach — previously any teacher could pull any student's full
  // result slip regardless of assignment.
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    await assertTeacherClassAccess({ schoolId, teacherId, classId: student.classId });
  }

  // Same backfill as getClassResults: make sure this student has a Mark row
  // in every subject's marksheet for the session before summarizing.
  await ensureMarkRowsForSession({ schoolId, sessionId, classId: session.classId });

  const marks = await prisma.mark.findMany({
    where: {
      schoolId,
      studentId,
      markSheet: { examSessionId: sessionId },
    },
    select: {
      score: true,
      markSheet: {
        select: { subjectId: true, subject: { select: { id: true, name: true } } },
      },
    },
  });

  const subjectScores = marks.map((m) => ({
    subjectId: m.markSheet.subjectId,
    subjectName: m.markSheet.subject?.name || "NO_SUBJECT_NAME",
    score: m.score,
  }));

  const { classId: _studentClassId, ...studentOut } = student;

  return {
    session,
    student: studentOut,
    subjectScores,
    ...summarizeSubjectScores(subjectScores),
  };
}

export async function publishResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);
  const actorUserId = req.user.id;

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, status: true },
  });

  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });
  if (session.status === ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("Results already published."), { statusCode: 400 });
  }

  const notSubmitted = await prisma.markSheet.count({
    where: {
      schoolId,
      examSessionId: sessionId,
      status: { not: MarkSheetStatus.SUBMITTED },
    },
  });

  if (notSubmitted > 0) {
    throw Object.assign(
      new Error(`Cannot publish: ${notSubmitted} marksheet(s) are not yet submitted.`),
      { statusCode: 409 }
    );
  }

  await prisma.examSession.updateMany({
    where: { id: sessionId, schoolId },
    data: {
      status: ExamSessionStatus.PUBLISHED,
      publishedAt: new Date(),
      publishedById: actorUserId,
    },
  });

  const updated = await prisma.examSession.findFirst({ where: { id: sessionId, schoolId } });

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.PUBLISH,
    entityType: "ExamSession",
    entityId: sessionId,
    actorUserId,
    after: { status: updated.status },
  }));

  return updated;
}