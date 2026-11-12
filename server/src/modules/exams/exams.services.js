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
import { makeGrader, graderForClass } from "./exams.grades.js";
import { notifyResults } from "../sms/notify.js";
import { isSelfService, canSeeOwnLearner } from "../../utils/learnerAccess.js";
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

// Shared by getClassResults and getStudentResults so total/average/grade
// math is computed in exactly one place.
// Uses the class's grading scale (audit H8); the built-in A-E when none is set.
function summarizeSubjectScores(subjectScores, grader = makeGrader(null)) {
  const validScores = subjectScores.filter((s) => s.score != null).map((s) => Number(s.score));
  const total = validScores.reduce((a, b) => a + b, 0);
  const average = validScores.length ? total / validScores.length : 0;
  const overall = grader.overall(validScores);

  return {
    total,
    average: Number(average.toFixed(2)),
    overallGrade: overall.grade,
    meanPoints: overall.meanPoints,
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

  // An unassigned marksheet can only be taken by a teacher who teaches that
  // subject to that class (audit M8: any teacher in the school could).
  if (
    allowClaim &&
    markSheet.teacherId === null &&
    (await teachesSubject({
      schoolId: req.user.schoolId,
      teacherId,
      classId: markSheet.examSession?.classId,
      subjectId: markSheet.subjectId,
    }))
  ) {
    return;
  }

  throw Object.assign(new Error("Access denied: not your marksheet."), { statusCode: 403 });
}

async function teachesSubject({ schoolId, teacherId, classId, subjectId }) {
  if (!teacherId || !classId || !subjectId) return false;
  const row = await prisma.teachingAssignment.findFirst({
    where: { schoolId, teacherId, classId, subjectId, isActive: true },
    select: { id: true },
  });
  return !!row;
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
    // The Term enum is uppercase (TERM1...). This used to lowercase the value
    // and keep assertTerm's (undefined) return, so any term filter failed.
    const termStr = String(termRaw).trim().toUpperCase();
    if (termStr === "ALL") {
      termFilter = undefined; // all terms
    } else {
      try {
        assertTerm(termStr);
      } catch (e) {
        throw Object.assign(e, { statusCode: 400 });
      }
      termFilter = termStr;
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

  // A STUDENT may list only the published sessions of their own class, so the
  // Results page can offer them their result slips. Anything they pass for
  // classId or status is overridden.
  if (req.user.role === "STUDENT") {
    const me = req.user.studentId
      ? await prisma.student.findFirst({
          where: { id: req.user.studentId, schoolId },
          select: { classId: true },
        })
      : null;
    if (!me?.classId) return [];
    where.classId = me.classId;
    where.status = ExamSessionStatus.PUBLISHED;
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
    if (
      ms.teacherId === null &&
      !(await teachesSubject({ schoolId, teacherId, classId: ms.examSession.classId, subjectId: ms.subjectId }))
    ) {
      throw Object.assign(new Error("Not your marksheet."), { statusCode: 403 });
    }
  } else {
    await assertMarkSheetAccess(req, ms);
  }

  // Add rows for learners who joined the class since the sheet was made, so
  // they can be marked. Only while marks can still change.
  if (ms.examSession.status !== ExamSessionStatus.PUBLISHED) {
    await ensureMarkRowsForCurrentStudents({
      schoolId,
      markSheetId: ms.id,
      classId: ms.examSession.classId,
    });
  }

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
      subjectId: true,
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
    const taught = await prisma.teachingAssignment.findMany({
      where: { schoolId, teacherId, classId: session.classId, isActive: true },
      select: { subjectId: true },
    });
    where.OR = [{ teacherId }, { teacherId: null, subjectId: { in: taught.map((t) => t.subjectId) } }];
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
// Before publishing, results are calculated live from the marks (and nothing
// is written while reading). Publishing saves a frozen copy in
// ResultPublish / StudentResult / SubjectResult, and every read of a
// published session uses that copy, so a result slip that has gone home
// can't change because a student later moved class or left (audit H9).
// To correct a published result an admin unpublishes it (with a reason),
// fixes the marks, and publishes again.

function rankResults(results) {
  // Ranking: ties share a position.
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
  return results;
}

/**
 * Live results for a session, read-only. Includes every active student
 * currently in the class (with blanks where marks are missing) and any
 * active student who has marks in this session.
 * Shape: { subjects: [{id,name}], results: [{ student, subjectScores, total, average, overallGrade, missingCount, position }] }
 */
async function computeLiveResults(db, { schoolId, session }) {
  const grader = await graderForClass(db, { schoolId, classId: session.classId });
  const [sheets, classStudents, marks] = await Promise.all([
    db.markSheet.findMany({
      where: { schoolId, examSessionId: session.id },
      select: { id: true, subjectId: true, subject: { select: { id: true, name: true } } },
    }),
    db.student.findMany({
      where: { schoolId, classId: session.classId, isActive: true },
      select: { id: true, admissionNo: true, firstName: true, lastName: true },
    }),
    db.mark.findMany({
      where: { schoolId, markSheet: { examSessionId: session.id }, student: { isActive: true } },
      select: {
        studentId: true,
        score: true,
        markSheet: { select: { subjectId: true } },
        student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  const subjects = [];
  const seenSubjects = new Set();
  for (const ms of sheets) {
    if (seenSubjects.has(ms.subjectId)) continue;
    seenSubjects.add(ms.subjectId);
    subjects.push({ id: ms.subjectId, name: ms.subject?.name || "NO_SUBJECT_NAME" });
  }

  subjects.sort((a, b) => a.name.localeCompare(b.name));

  const students = new Map(classStudents.map((st) => [st.id, st]));
  const scoreOf = new Map(); // `${studentId}:${subjectId}` -> score
  for (const m of marks) {
    students.set(m.studentId, m.student);
    scoreOf.set(`${m.studentId}:${m.markSheet.subjectId}`, m.score);
  }

  const results = [...students.values()].map((student) => {
    const subjectScores = subjects.map((sub) => {
      const score = scoreOf.get(`${student.id}:${sub.id}`) ?? null;
      return { subjectId: sub.id, subjectName: sub.name, score, grade: grader.grade(score)?.label ?? null };
    });
    return { student, subjectScores, ...summarizeSubjectScores(subjectScores, grader) };
  });

  return { subjects, results: rankResults(results), grader, gradeScale: grader.scale };
}

/** The frozen copy of a published session, in the same shape as live results; null if none. */
async function readFrozenResults({ schoolId, sessionId, studentId = null }) {
  const publish = await prisma.resultPublish.findFirst({
    where: { schoolId, examSessionId: sessionId },
    select: {
      id: true,
      publishedAt: true,
      studentResults: {
        where: studentId ? { studentId } : undefined,
        orderBy: [{ position: "asc" }, { admissionNo: "asc" }],
        select: {
          studentId: true,
          totalScore: true,
          averageScore: true,
          overallGrade: true,
          position: true,
          missingCount: true,
          studentName: true,
          admissionNo: true,
          subjectResults: { select: { subjectId: true, subjectName: true, score: true, grade: true } },
        },
      },
    },
  });
  if (!publish) return null;

  const subjects = [];
  const seen = new Set();
  const results = publish.studentResults.map((r) => {
    for (const sr of r.subjectResults) {
      if (!seen.has(sr.subjectId)) {
        seen.add(sr.subjectId);
        subjects.push({ id: sr.subjectId, name: sr.subjectName || "NO_SUBJECT_NAME" });
      }
    }
    const [firstName, ...rest] = String(r.studentName || "").split(" ");
    return {
      student: { id: r.studentId, admissionNo: r.admissionNo, firstName: firstName || "", lastName: rest.join(" ") },
      subjectScores: r.subjectResults
        .map((sr) => ({ subjectId: sr.subjectId, subjectName: sr.subjectName || "NO_SUBJECT_NAME", score: sr.score, grade: sr.grade }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
      total: r.totalScore,
      average: r.averageScore,
      overallGrade: r.overallGrade,
      missingCount: r.missingCount,
      position: r.position,
    };
  });
  // Keep the subject order the slips were published with.
  subjects.sort((a, b) => a.name.localeCompare(b.name));
  return { publishedAt: publish.publishedAt, subjects, results };
}

const sessionSummarySelect = { id: true, classId: true, term: true, year: true, name: true, status: true };

export async function getClassResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({ where: { id: sessionId, schoolId }, select: sessionSummarySelect });
  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });

  // TEACHER callers may only view results for classes they actually teach.
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    await assertTeacherClassAccess({ schoolId, teacherId, classId: session.classId });
  }

  if (session.status === ExamSessionStatus.PUBLISHED) {
    const frozen = await readFrozenResults({ schoolId, sessionId });
    if (frozen) return { session, subjects: frozen.subjects, results: frozen.results, frozen: true, publishedAt: frozen.publishedAt };
  }

  const live = await computeLiveResults(prisma, { schoolId, session });
  return { session, subjects: live.subjects, results: live.results, gradeScale: live.gradeScale, frozen: false };
}

/**
 * A single student's results for one exam session (the "student slip").
 * Route: GET /sessions/:id/results/students/:studentId
 * STUDENT callers may only fetch their own, and only once published.
 */
export async function getStudentResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);
  const studentId = assertCuid("studentId", req.params?.studentId);

  if (isSelfService(req) && !(await canSeeOwnLearner(req, studentId))) {
    throw Object.assign(new Error("Students can only view their own results."), { statusCode: 403 });
  }

  const session = await prisma.examSession.findFirst({ where: { id: sessionId, schoolId }, select: sessionSummarySelect });
  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });

  if (isSelfService(req) && session.status !== ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("These results have not been published yet."), { statusCode: 403 });
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, classId: true },
  });
  if (!student) throw Object.assign(new Error("Student not found."), { statusCode: 404 });

  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    await assertTeacherClassAccess({ schoolId, teacherId, classId: student.classId });
  }

  const { classId: _studentClassId, ...studentOut } = student;

  if (session.status === ExamSessionStatus.PUBLISHED) {
    const frozen = await readFrozenResults({ schoolId, sessionId, studentId });
    if (frozen) {
      const r = frozen.results[0];
      if (!r) throw Object.assign(new Error("This student has no published result for this exam."), { statusCode: 404 });
      return {
        session,
        student: studentOut,
        subjectScores: r.subjectScores,
        total: r.total,
        average: r.average,
        overallGrade: r.overallGrade,
        missingCount: r.missingCount,
        position: r.position,
        outOf: (await prisma.studentResult.count({ where: { schoolId, resultPublish: { examSessionId: sessionId } } })),
        frozen: true,
        publishedAt: frozen.publishedAt,
      };
    }
  }

  const live = await computeLiveResults(prisma, { schoolId, session });
  const mine = live.results.find((x) => x.student.id === studentId);
  const subjectScores = mine
    ? mine.subjectScores
    : live.subjects.map((s) => ({ subjectId: s.id, subjectName: s.name, score: null, grade: null }));
  return {
    session,
    student: studentOut,
    subjectScores,
    ...summarizeSubjectScores(subjectScores, live.grader),
    gradeScale: live.gradeScale,
    position: mine?.position ?? null,
    outOf: live.results.length,
    frozen: false,
  };
}

/**
 * Saves the frozen copy of a session's results (inside a transaction).
 * Used when publishing, and by scripts/freezePublishedResults.js for
 * sessions published before frozen copies existed.
 */
export async function writeResultSnapshot(tx, { schoolId, session, publishedById, publishedAt = null }) {
  const live = await computeLiveResults(tx, { schoolId, session });
  await tx.resultPublish.deleteMany({ where: { schoolId, examSessionId: session.id } });
  const publish = await tx.resultPublish.create({
    data: {
      schoolId,
      examSessionId: session.id,
      publishedById,
      gradeScaleId: live.grader.scale.id,
      ...(publishedAt ? { publishedAt } : {}),
    },
  });
  for (const r of live.results) {
    await tx.studentResult.create({
      data: {
        schoolId,
        resultPublishId: publish.id,
        studentId: r.student.id,
        totalScore: r.total,
        averageScore: r.average,
        overallGrade: r.overallGrade,
        position: r.position,
        missingCount: r.missingCount,
        studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
        admissionNo: r.student.admissionNo,
        subjectResults: {
          create: r.subjectScores.map((sc) => ({
            schoolId,
            subjectId: sc.subjectId,
            subjectName: sc.subjectName,
            score: sc.score,
            grade: sc.grade,
          })),
        },
      },
    });
  }
  return live.results.length;
}

export async function publishResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);
  const actorUserId = req.user.id;

  const session = await prisma.examSession.findFirst({ where: { id: sessionId, schoolId }, select: sessionSummarySelect });
  if (!session) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });
  if (session.status === ExamSessionStatus.PUBLISHED) {
    throw Object.assign(new Error("Results already published."), { statusCode: 400 });
  }

  const notSubmitted = await prisma.markSheet.count({
    where: { schoolId, examSessionId: sessionId, status: { not: MarkSheetStatus.SUBMITTED } },
  });
  if (notSubmitted > 0) {
    throw Object.assign(new Error(`Cannot publish: ${notSubmitted} marksheet(s) are not yet submitted.`), {
      statusCode: 409,
    });
  }

  const updated = await prisma.$transaction(
    async (tx) => {
      // Flip DRAFT -> PUBLISHED atomically: a second publish racing this one gets 0 rows.
      const flipped = await tx.examSession.updateMany({
        where: { id: sessionId, schoolId, status: ExamSessionStatus.DRAFT },
        data: { status: ExamSessionStatus.PUBLISHED, publishedAt: new Date(), publishedById: actorUserId },
      });
      if (flipped.count !== 1) throw Object.assign(new Error("Results already published."), { statusCode: 400 });

      await writeResultSnapshot(tx, { schoolId, session, publishedById: actorUserId });
      return tx.examSession.findFirst({ where: { id: sessionId, schoolId } });
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.PUBLISH,
    entityType: "ExamSession",
    entityId: sessionId,
    actorUserId,
    after: { status: updated.status },
  }));

  // "Results are out" to parents, if the school has it on (never blocks publishing).
  notifyResults({ schoolId, sessionId, actorId: actorUserId });

  return updated;
}

/**
 * ADMIN: take published results back to draft to correct them. The frozen
 * copy is discarded (the audit log keeps the reason); marksheets stay
 * submitted, so the admin unlocks the one that needs fixing, the teacher
 * corrects and resubmits, and the session is published again.
 */
export async function unpublishResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);
  const actorUserId = req.user.id;
  const reason = cleanStr(req.body?.reason);
  if (!reason) throw Object.assign(new Error("Say why the results are being unpublished."), { statusCode: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    const flipped = await tx.examSession.updateMany({
      where: { id: sessionId, schoolId, status: ExamSessionStatus.PUBLISHED },
      data: { status: ExamSessionStatus.DRAFT, publishedAt: null, publishedById: null },
    });
    if (flipped.count !== 1) {
      const exists = await tx.examSession.findFirst({ where: { id: sessionId, schoolId }, select: { id: true } });
      if (!exists) throw Object.assign(new Error("Exam session not found."), { statusCode: 404 });
      throw Object.assign(new Error("These results are not published."), { statusCode: 400 });
    }
    await tx.resultPublish.deleteMany({ where: { schoolId, examSessionId: sessionId } });
    return tx.examSession.findFirst({ where: { id: sessionId, schoolId } });
  });

  await audit(schoolId, buildAuditPayload({
    action: ExamAuditAction.UNPUBLISH,
    entityType: "ExamSession",
    entityId: sessionId,
    actorUserId,
    before: { status: ExamSessionStatus.PUBLISHED },
    after: { status: updated.status, reason },
  }));

  return updated;
}
