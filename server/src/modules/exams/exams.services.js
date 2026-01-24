// src/modules/exams/exams.services.js
import {
  PrismaClient,
  MarkSheetStatus,
  ExamSessionStatus,
  ExamAuditAction,
} from "@prisma/client";

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

const prisma = new PrismaClient();

// ---------------------------
// Helpers
// ---------------------------
async function audit(schoolId, data) {
  return prisma.examAuditLog.create({ data: { schoolId, ...data } });
}

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

async function getTeacherIdFromReq(req) {
  return req.user?.teacherId || req.user?.teacher?.id || null;
}

/**
 * Smart marksheet access:
 * - ADMIN: always allowed
 * - TEACHER:
 *    - allowed if marksheet.teacherId === teacherId
 *    - allowed if marksheet.teacherId === null AND allowClaim === true (first write can claim it)
 *    - otherwise denied
 */
async function assertMarkSheetAccess(req, markSheet, { allowClaim = false } = {}) {
  if (req.user.role === "ADMIN") return;

  const teacherId = await getTeacherIdFromReq(req);
  if (!teacherId) {
    const e = new Error("Teacher profile not linked to user.");
    e.statusCode = 403;
    throw e;
  }

  if (markSheet.teacherId === teacherId) return;

  if (allowClaim && markSheet.teacherId === null) return;

  const e = new Error("Access denied: not your marksheet.");
  e.statusCode = 403;
  throw e;
}

/**
 * Claim a marksheet for a teacher in a race-safe way:
 * - Only claims if teacherId is currently null
 * - Uses updateMany to avoid overwriting if someone else claimed first
 */
async function claimMarkSheetIfUnassigned({ schoolId, markSheetId, teacherId }) {
  const res = await prisma.markSheet.updateMany({
    where: { id: markSheetId, schoolId, teacherId: null },
    data: { teacherId },
  });
  return res.count === 1;
}

/**
 * CRITICAL FIX:
 * Ensure marks exist for all current students in the class.
 * This closes the lifecycle gap where students are added AFTER session creation.
 *
 * - Inserts only missing rows (skipDuplicates + set diff)
 * - Keeps score null, isMissing true
 */
async function ensureMarkRowsForCurrentStudents({ schoolId, markSheetId, classId }) {
  // 1) Current students
  const students = await prisma.student.findMany({
    where: { schoolId, classId, isActive: true },
    select: { id: true },
  });

  if (!students.length) return { added: 0 };

  // 2) Existing mark studentIds
  const existing = await prisma.mark.findMany({
    where: { schoolId, markSheetId },
    select: { studentId: true },
  });

  const have = new Set(existing.map((m) => m.studentId));
  const missing = students.filter((s) => !have.has(s.id));

  if (!missing.length) return { added: 0 };

  // 3) Insert missing mark rows
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

// ---------------------------
// Exam Types
// ---------------------------
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
  if (!name) throw new Error("name is required.");

  const code = req.body?.code ? cleanStr(req.body.code) : null;

  const weight =
    req.body?.weight !== undefined && req.body?.weight !== null
      ? Number(req.body.weight)
      : null;

  if (weight !== null && (Number.isNaN(weight) || weight <= 0 || weight > 1)) {
    throw new Error("weight must be a number between (0, 1].");
  }

  const created = await prisma.examType.create({
    data: { schoolId, name, code, weight, isActive: true },
    select: examTypeSelect,
  });

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.CREATE,
      entityType: "ExamType",
      entityId: created.id,
      actorUserId,
      after: created,
    })
  );

  return created;
}

// ---------------------------
// Exam Sessions
// ---------------------------
export async function createExamSession(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;

  const year = assertInt("year", req.body?.year);
  const term = req.body?.term;
  assertTerm(term);

  const classId = assertCuid("classId", req.body?.classId);
  const examTypeId = assertCuid("examTypeId", req.body?.examTypeId);
  const name = req.body?.name ? cleanStr(req.body.name) : null;

  const [classRow, typeRow] = await Promise.all([
    prisma.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } }),
    prisma.examType.findFirst({
      where: { id: examTypeId, schoolId, isActive: true },
      select: { id: true },
    }),
  ]);

  if (!classRow) throw new Error("Invalid classId for this school.");
  if (!typeRow) throw new Error("Invalid examTypeId for this school.");

  const session = await prisma.examSession.create({
    data: {
      schoolId,
      year,
      term,
      classId,
      examTypeId,
      name,
      createdByUserId: actorUserId,
      status: ExamSessionStatus.DRAFT,
    },
    select: examSessionSelect,
  });

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.CREATE,
      entityType: "ExamSession",
      entityId: session.id,
      actorUserId,
      after: session,
    })
  );

  // Precreate markSheets (ALWAYS)
  const assignments = await prisma.teachingAssignment.findMany({
    where: { schoolId, classId, isActive: true },
    select: { teacherId: true, subjectId: true },
  });

  let sheetRows = [];

  if (assignments.length > 0) {
    const bySubject = new Map();
    for (const a of assignments) {
      // first wins; tweak if you want multiple teachers per subject
      if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a.teacherId);
    }

    sheetRows = [...bySubject.entries()].map(([subjectId, teacherId]) => ({
      schoolId,
      examSessionId: session.id,
      subjectId,
      teacherId,
      status: MarkSheetStatus.DRAFT,
    }));
  } else {
    const subjects = await prisma.subject.findMany({
      where: { schoolId, isActive: true },
      select: { id: true },
      orderBy: { name: "asc" },
    });

    sheetRows = subjects.map((s) => ({
      schoolId,
      examSessionId: session.id,
      subjectId: s.id,
      teacherId: null, // unassigned (claimable later)
      status: MarkSheetStatus.DRAFT,
    }));
  }

  if (sheetRows.length) {
    await prisma.markSheet.createMany({ data: sheetRows, skipDuplicates: true });

    // Create marks for students that exist *now* (sync later will cover late students)
    const [students, createdSheets] = await Promise.all([
      prisma.student.findMany({
        where: { schoolId, classId, isActive: true },
        select: { id: true },
      }),
      prisma.markSheet.findMany({
        where: { schoolId, examSessionId: session.id },
        select: { id: true },
      }),
    ]);

    const markRows = [];
    for (const ms of createdSheets) {
      for (const st of students) {
        markRows.push({
          schoolId,
          markSheetId: ms.id,
          studentId: st.id,
          score: null,
          isMissing: true,
          comment: null,
        });
      }
    }

    if (markRows.length) {
      await prisma.mark.createMany({ data: markRows, skipDuplicates: true });
    }
  }

  return session;
}

export async function listExamSessions(req) {
  const schoolId = req.user.schoolId;
  const { year, term, classId, status } = req.query;

  const where = { schoolId };
  if (year) where.year = assertInt("year", year);
  if (term) {
    assertTerm(term);
    where.term = term;
  }
  if (classId) where.classId = String(classId);
  if (status) where.status = status;

  return prisma.examSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: examSessionSelect,
  });
}

// ---------------------------
// MarkSheets
// ---------------------------
export async function getMarkSheet(req) {
  const schoolId = req.user.schoolId;
  const id = assertCuid("markSheetId", req.params?.id);

  // fetch minimal first (for access + classId)
  const ms0 = await prisma.markSheet.findFirst({
    where: { id, schoolId },
    select: {
      ...markSheetSelect,
      examSession: {
        select: { id: true, status: true, year: true, term: true, classId: true, name: true },
      },
      teacherId: true,
      status: true,
    },
  });

  if (!ms0) throw new Error("MarkSheet not found.");

  // access
  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    if (!teacherId) {
      const e = new Error("Teacher profile not linked to user.");
      e.statusCode = 403;
      throw e;
    }
    // allow view if assigned or unassigned; block if assigned to another teacher
    if (ms0.teacherId !== null && ms0.teacherId !== teacherId) {
      const e = new Error("Access denied: not your marksheet.");
      e.statusCode = 403;
      throw e;
    }
  } else {
    await assertMarkSheetAccess(req, ms0);
  }

  // ✅ CRITICAL: ensure mark rows exist for current students
  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId: ms0.id,
    classId: ms0.examSession.classId,
  });

  // Re-fetch full marksheet (now marks will exist and include student objects)
  const ms = await prisma.markSheet.findFirst({
    where: { id, schoolId },
    select: {
      ...markSheetSelect,
      examSession: {
        select: { id: true, status: true, year: true, term: true, classId: true, name: true },
      },
      marks: {
        select: {
          id: true,
          studentId: true,
          score: true,
          isMissing: true,
          comment: true,
          updatedAt: true,
          student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } },
        },
        orderBy: [{ student: { admissionNo: "asc" } }],
      },
    },
  });

  return ms;
}

export async function upsertBulkMarks(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const markSheetId = assertCuid("markSheetId", req.params?.id);

  const marks = validateBulkMarksPayload(req.body);

  const ms = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: {
      id: true,
      status: true,
      teacherId: true,
      examSession: { select: { id: true, status: true, classId: true } },
    },
  });

  if (!ms) throw new Error("MarkSheet not found.");

  // Allow teacher to write if it's theirs OR unassigned (they will claim it)
  await assertMarkSheetAccess(req, ms, { allowClaim: true });

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw new Error("Cannot edit marks after results are published.");
  }

  assertMarkSheetEditable(ms.status);

  // Ensure marks exist for current students (covers late student additions)
  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId: ms.id,
    classId: ms.examSession.classId,
  });

  // If teacher is writing and sheet is unassigned, claim it (race-safe)
  if (req.user.role === "TEACHER" && ms.teacherId === null) {
    const teacherId = await getTeacherIdFromReq(req);

    const claimed = await claimMarkSheetIfUnassigned({
      schoolId,
      markSheetId,
      teacherId,
    });

    if (!claimed) {
      const fresh = await prisma.markSheet.findFirst({
        where: { id: markSheetId, schoolId },
        select: { teacherId: true },
      });
      if (!fresh || fresh.teacherId !== teacherId) {
        const e = new Error("Access denied: marksheet already claimed by another teacher.");
        e.statusCode = 403;
        throw e;
      }
    }
  }

  // validate student belongs to class (security)
  const allowed = await prisma.student.findMany({
    where: { schoolId, classId: ms.examSession.classId, isActive: true },
    select: { id: true },
  });
  const allowedSet = new Set(allowed.map((s) => s.id));

  for (const row of marks) {
    const sid = String(row.studentId);
    if (!allowedSet.has(sid)) throw new Error(`Invalid studentId for this class: ${sid}`);
  }

  const tx = [];

  for (const row of marks) {
    const studentId = String(row.studentId);
    const score = row.score === null || row.score === undefined ? null : Number(row.score);

    if (score !== null) {
      if (Number.isNaN(score)) throw new Error("Score must be a number or null.");
      if (score < 0 || score > 100) throw new Error("Score must be between 0 and 100.");
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
          comment: row.comment ? String(row.comment).trim() : null,
        },
        update: {
          score,
          isMissing: score === null,
          comment: row.comment ? String(row.comment).trim() : null,
        },
        select: { id: true, studentId: true, score: true, isMissing: true, updatedAt: true },
      })
    );
  }

  const updated = await prisma.$transaction(tx);

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.UPDATE,
      entityType: "Mark",
      entityId: markSheetId,
      actorUserId,
      after: { updatedCount: updated.length },
    })
  );

  const [missingCount, filledCount] = await Promise.all([
    prisma.mark.count({ where: { schoolId, markSheetId, isMissing: true } }),
    prisma.mark.count({ where: { schoolId, markSheetId, isMissing: false } }),
  ]);

  return {
    markSheetId,
    updatedCount: updated.length,
    missingCount,
    filledCount,
    totalStudents: missingCount + filledCount,
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

  if (!ms) throw new Error("MarkSheet not found.");
  await assertMarkSheetAccess(req, ms);

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw new Error("Cannot submit after results are published.");
  }

  // ensure marks exist before checking missing
  await ensureMarkRowsForCurrentStudents({
    schoolId,
    markSheetId,
    classId: ms.examSession.classId,
  });

  const missing = await prisma.mark.count({
    where: { schoolId, markSheetId, isMissing: true },
  });
  if (missing > 0) throw new Error(`Cannot submit: ${missing} missing marks.`);

  const updated = await prisma.markSheet.update({
    where: { id: markSheetId },
    data: {
      status: MarkSheetStatus.SUBMITTED,
      submittedAt: new Date(),
      submittedById: actorUserId,
    },
    select: markSheetSelect,
  });

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.SUBMIT,
      entityType: "MarkSheet",
      entityId: markSheetId,
      actorUserId,
      before: { status: ms.status },
      after: { status: updated.status, submittedAt: updated.submittedAt },
    })
  );

  return updated;
}

export async function unlockMarkSheet(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const markSheetId = assertCuid("markSheetId", req.params?.id);

  const reason = cleanStr(req.body?.reason);
  if (!reason) throw new Error("reason is required.");

  const ms = await prisma.markSheet.findFirst({
    where: { id: markSheetId, schoolId },
    select: { id: true, status: true, examSession: { select: { status: true } } },
  });

  if (!ms) throw new Error("MarkSheet not found.");

  if (ms.examSession.status === ExamSessionStatus.PUBLISHED) {
    throw new Error("Cannot unlock after results are published.");
  }

  if (ms.status !== MarkSheetStatus.SUBMITTED) {
    throw new Error("Only SUBMITTED marksheets can be unlocked.");
  }

  const updated = await prisma.markSheet.update({
    where: { id: markSheetId },
    data: {
      status: MarkSheetStatus.UNLOCKED,
      unlockedAt: new Date(),
      unlockedById: actorUserId,
      unlockReason: reason,
    },
    select: markSheetSelect,
  });

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.UNLOCK,
      entityType: "MarkSheet",
      entityId: markSheetId,
      actorUserId,
      before: { status: ms.status },
      after: { status: updated.status, unlockReason: reason },
    })
  );

  return updated;
}

export async function listSessionMarkSheets(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, status: true, classId: true, year: true, term: true, name: true },
  });

  if (!session) throw new Error("ExamSession not found.");

  const where = { schoolId, examSessionId: sessionId };

  if (req.user.role === "TEACHER") {
    const teacherId = await getTeacherIdFromReq(req);
    if (!teacherId) {
      const e = new Error("Teacher profile not linked to user.");
      e.statusCode = 403;
      throw e;
    }
    // show my assigned + unassigned
    where.OR = [{ teacherId }, { teacherId: null }];
  }

  const markSheets = await prisma.markSheet.findMany({
    where,
    orderBy: [{ subject: { name: "asc" } }],
    select: markSheetSelect,
  });

  const ids = markSheets.map((m) => m.id);
  const missingMap = new Map();

  if (ids.length) {
    const missing = await prisma.mark.groupBy({
      by: ["markSheetId"],
      where: { schoolId, markSheetId: { in: ids }, isMissing: true },
      _count: { _all: true },
    });
    for (const row of missing) missingMap.set(row.markSheetId, row._count._all);
  }

  return {
    session,
    markSheets: markSheets.map((m) => ({
      ...m,
      missingCount: missingMap.get(m.id) ?? 0,
    })),
  };
}

// ---------------------------
// Results engine (Mode B)
// ---------------------------
function sortAndRank(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.average !== a.average) return b.average - a.average;
    return String(a.student?.admissionNo || "").localeCompare(String(b.student?.admissionNo || ""));
  });

  let pos = 0;
  let lastTotal = null;
  let lastAvg = null;
  let index = 0;

  for (const r of sorted) {
    index += 1;
    if (lastTotal === null || r.total !== lastTotal || r.average !== lastAvg) {
      pos = index;
      lastTotal = r.total;
      lastAvg = r.average;
    }
    r.position = pos;
  }

  return sorted;
}

export async function getClassResults(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, year: true, term: true, classId: true, status: true, name: true },
  });
  if (!session) throw new Error("ExamSession not found.");

  if (req.user.role === "STUDENT" && session.status !== ExamSessionStatus.PUBLISHED) {
    throw new Error("Results are not published yet.");
  }

  const markSheets = await prisma.markSheet.findMany({
    where: { schoolId, examSessionId: sessionId },
    orderBy: [{ subject: { name: "asc" } }],
    select: {
      id: true,
      subjectId: true,
      subject: { select: { id: true, name: true, code: true } },
      marks: { select: { studentId: true, score: true, isMissing: true } },
    },
  });

  const subjects = markSheets.map((ms) => ms.subject).filter(Boolean);
  const subjectIds = subjects.map((s) => s.id);
  const subjIndex = new Map(subjectIds.map((id, idx) => [id, idx]));

  const students = await prisma.student.findMany({
    where: { schoolId, classId: session.classId, isActive: true },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, gender: true },
    orderBy: [{ admissionNo: "asc" }],
  });

  const base = new Map();
  for (const st of students) {
    base.set(st.id, {
      student: st,
      subjectScores: subjectIds.map(() => ({ score: null, grade: null })),
      missingCount: 0,
      total: 0,
      average: 0,
      position: null,
      overallGrade: null,
    });
  }

  for (const ms of markSheets) {
    const idx = subjIndex.get(ms.subjectId);
    if (idx === undefined) continue;

    for (const mk of ms.marks) {
      const row = base.get(mk.studentId);
      if (!row) continue;

      if (mk.isMissing || mk.score === null || mk.score === undefined) {
        row.subjectScores[idx] = { score: null, grade: null };
      } else {
        const score = Number(mk.score);
        row.subjectScores[idx] = {
          score,
          grade: gradeFromScore(score, DEFAULT_GRADE_BANDS),
        };
      }
    }
  }

  for (const row of base.values()) {
    let total = 0;
    let miss = 0;

    for (const cell of row.subjectScores) {
      const sc = cell?.score;
      if (sc === null || sc === undefined) {
        miss += 1;
      } else {
        total += Number(sc);
      }
    }

    row.missingCount = miss;
    row.total = total;
    row.average = subjectIds.length ? total / subjectIds.length : 0;
    row.overallGrade = gradeFromScore(row.average, DEFAULT_GRADE_BANDS);
  }

  const results = sortAndRank([...base.values()]);

  return {
    session: {
      id: session.id,
      name: session.name,
      year: session.year,
      term: session.term,
      classId: session.classId,
      status: session.status,
    },
    subjects,
    results,
    meta: {
      maxScorePerSubject: 100,
      totalMax: subjectIds.length * 100,
      computedAt: new Date().toISOString(),
      grading: {
        mode: "B",
        bands: DEFAULT_GRADE_BANDS,
        perSubject: true,
        overall: "average",
        missingPolicy: "MISSING_AS_ZERO",
      },
    },
  };
}

export async function getStudentResults(req) {
  const sessionId = assertCuid("sessionId", req.params?.id);
  const studentId = assertCuid("studentId", req.params?.studentId);

  if (req.user.role === "STUDENT" && req.user.studentId !== studentId) {
    throw new Error("Forbidden: cannot view other student's results.");
  }

  const classResults = await getClassResults({ ...req, params: { id: sessionId } });
  const row = classResults.results.find((r) => r.student.id === studentId);
  if (!row) throw new Error("Student not found in this class/session.");

  return {
    session: classResults.session,
    subjects: classResults.subjects,
    student: row.student,
    subjectScores: row.subjectScores,
    total: row.total,
    average: row.average,
    position: row.position,
    missingCount: row.missingCount,
    overallGrade: row.overallGrade,
    meta: classResults.meta,
  };
}

// ---------------------------
// Publish (locks session)
// ---------------------------
export async function publishResults(req) {
  const schoolId = req.user.schoolId;
  const actorUserId = req.user.id;
  const sessionId = assertCuid("sessionId", req.params?.id);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error("ExamSession not found.");

  if (session.status === ExamSessionStatus.PUBLISHED) {
    throw new Error("Session is already published.");
  }

  const notSubmitted = await prisma.markSheet.count({
    where: { schoolId, examSessionId: sessionId, status: { not: MarkSheetStatus.SUBMITTED } },
  });

  if (notSubmitted > 0) throw new Error("Cannot publish: some marksheets are not submitted.");

  await prisma.examSession.update({
    where: { id: sessionId },
    data: { status: ExamSessionStatus.PUBLISHED },
  });

  await audit(
    schoolId,
    buildAuditPayload({
      action: ExamAuditAction.PUBLISH,
      entityType: "ExamSession",
      entityId: sessionId,
      actorUserId,
      before: { status: session.status },
      after: { status: ExamSessionStatus.PUBLISHED },
    })
  );

  return { message: "Results published", sessionId };
}
