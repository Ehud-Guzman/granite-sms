// src/modules/exams/reportCards.js
// Term report cards (audit missing feature 6): every PUBLISHED exam of a class
// in a term combined by exam-type weight, graded with the class's scale, with
// position, attendance and comments.
//
// Built only from published (frozen) results, so a report card can't show a
// mark that hasn't been released, and doesn't move when a learner later
// changes class.
import { prisma } from "../../lib/prisma.js";
import { graderForClass } from "./exams.grades.js";
import { assertCuid, assertInt, assertTerm } from "./exams.validators.js";
import { teacherClassIds } from "../../utils/teacherScope.js";

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

/**
 * Builds the term report for one class: { class, sessions, gradeScale, students[] }.
 * Each subject's term score = sum(score x weight) / sum(weights of the exams
 * the learner sat). Exam types without a weight count as 1.
 */
export async function buildTermReport({ schoolId, classId, year, term, studentId = null }) {
  const klass = await prisma.class.findFirst({
    where: { id: classId, schoolId },
    select: { id: true, name: true, stream: true, year: true },
  });
  if (!klass) throw httpError(404, "Class not found.");

  const sessions = await prisma.examSession.findMany({
    where: { schoolId, classId, year, term, status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      examType: { select: { name: true, weight: true } },
      publish: {
        select: {
          studentResults: {
            where: studentId ? { studentId } : undefined,
            select: {
              studentId: true,
              studentName: true,
              admissionNo: true,
              subjectResults: { select: { subjectId: true, subjectName: true, score: true } },
            },
          },
        },
      },
    },
  });
  const grader = await graderForClass(prisma, { schoolId, classId });
  const weightOf = (s) => (s.examType?.weight && s.examType.weight > 0 ? Number(s.examType.weight) : 1);

  // studentId -> { student, subjects: Map(subjectId -> { name, perSession, sum, w }) }
  const byStudent = new Map();
  const subjectNames = new Map();
  for (const s of sessions) {
    const w = weightOf(s);
    for (const r of s.publish?.studentResults || []) {
      if (!byStudent.has(r.studentId)) {
        const [firstName, ...rest] = String(r.studentName || "").split(" ");
        byStudent.set(r.studentId, {
          student: { id: r.studentId, admissionNo: r.admissionNo, firstName, lastName: rest.join(" ") },
          subjects: new Map(),
        });
      }
      const row = byStudent.get(r.studentId);
      for (const sr of r.subjectResults) {
        subjectNames.set(sr.subjectId, sr.subjectName || "");
        if (!row.subjects.has(sr.subjectId)) row.subjects.set(sr.subjectId, { perSession: {}, sum: 0, w: 0 });
        const cell = row.subjects.get(sr.subjectId);
        cell.perSession[s.id] = sr.score;
        if (sr.score != null) {
          cell.sum += Number(sr.score) * w;
          cell.w += w;
        }
      }
    }
  }

  const subjectList = [...subjectNames.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // Attendance for the term, from submitted/locked registers.
  const ids = [...byStudent.keys()];
  const att = ids.length
    ? await prisma.attendanceRecord.groupBy({
        by: ["studentId", "status"],
        where: { schoolId, studentId: { in: ids }, status: { not: "UNMARKED" }, session: { year, term } },
        _count: { _all: true },
      })
    : [];
  const attendance = new Map();
  for (const a of att) {
    const x = attendance.get(a.studentId) || { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    x[a.status.toLowerCase()] = a._count._all;
    x.total += a._count._all;
    attendance.set(a.studentId, x);
  }

  const comments = ids.length
    ? await prisma.reportCardComment.findMany({ where: { schoolId, studentId: { in: ids }, year, term } })
    : [];
  const commentOf = new Map(comments.map((c) => [c.studentId, c]));

  const students = [...byStudent.values()].map(({ student, subjects }) => {
    const rows = subjectList.map((sub) => {
      const cell = subjects.get(sub.id);
      const termScore = cell && cell.w > 0 ? Number((cell.sum / cell.w).toFixed(1)) : null;
      const g = grader.grade(termScore);
      return {
        subjectId: sub.id,
        subjectName: sub.name,
        perSession: cell?.perSession || {},
        termScore,
        grade: g?.label ?? null,
        remark: g?.remark ?? null,
      };
    });
    const scored = rows.filter((r) => r.termScore != null).map((r) => r.termScore);
    const total = Number(scored.reduce((a, b) => a + b, 0).toFixed(1));
    const average = scored.length ? Number((total / scored.length).toFixed(2)) : 0;
    const overall = grader.overall(scored);
    const a = attendance.get(student.id) || null;
    const c = commentOf.get(student.id);
    return {
      student,
      subjects: rows,
      total,
      average,
      overallGrade: overall.grade,
      meanPoints: overall.meanPoints,
      attendance: a ? { ...a, ratePct: a.total ? Math.round(((a.present + a.late) / a.total) * 100) : null } : null,
      comments: { classTeacher: c?.classTeacherComment || "", head: c?.headComment || "" },
    };
  });

  // Position by average (ties share a place).
  students.sort((x, y) => y.average - x.average || y.total - x.total);
  let pos = 0;
  students.forEach((s, i) => {
    if (i === 0 || s.average !== students[i - 1].average || s.total !== students[i - 1].total) pos = i + 1;
    s.position = pos;
  });

  return {
    class: klass,
    year,
    term,
    gradeScale: grader.scale,
    sessions: sessions.map((s) => ({ id: s.id, name: s.name || s.examType?.name || "Exam", examType: s.examType?.name || null, weight: weightOf(s) })),
    subjects: subjectList,
    outOf: students.length,
    students,
  };
}

/** GET /api/exams/report-cards?classId&year&term (ADMIN; TEACHER for own classes) */
export async function getClassReportCards(req) {
  const schoolId = req.schoolId;
  const classId = assertCuid("classId", req.query?.classId);
  const year = assertInt("year", req.query?.year);
  const term = String(req.query?.term || "");
  assertTerm(term);
  if (req.user.role === "TEACHER") {
    const allowed = await teacherClassIds(schoolId, req.user.teacherId);
    if (!allowed.includes(classId)) throw httpError(403, "Teacher not authorized for this class.");
  }
  return buildTermReport({ schoolId, classId, year, term });
}

/**
 * GET /api/exams/report-cards/students/:studentId?year&term
 * ADMIN, TEACHER (own classes) or the STUDENT themselves. The class is the
 * one the learner's results were published under that term.
 */
export async function getStudentReportCard(req) {
  const schoolId = req.schoolId;
  const studentId = assertCuid("studentId", req.params?.studentId);
  const year = assertInt("year", req.query?.year);
  const term = String(req.query?.term || "");
  assertTerm(term);
  if (req.user.role === "STUDENT" && req.user.studentId !== studentId) {
    throw httpError(403, "Students can only view their own report card.");
  }

  const any = await prisma.studentResult.findFirst({
    where: { schoolId, studentId, resultPublish: { examSession: { year, term } } },
    select: { resultPublish: { select: { examSession: { select: { classId: true } } } } },
  });
  if (!any) throw httpError(404, "No published results for this learner in that term yet.");
  const classId = any.resultPublish.examSession.classId;

  if (req.user.role === "TEACHER") {
    const allowed = await teacherClassIds(schoolId, req.user.teacherId);
    if (!allowed.includes(classId)) throw httpError(403, "Teacher not authorized for this class.");
  }

  // Position needs the whole class; then keep just this learner.
  const report = await buildTermReport({ schoolId, classId, year, term });
  const mine = report.students.find((s) => s.student.id === studentId);
  if (!mine) throw httpError(404, "No published results for this learner in that term yet.");
  return { ...report, students: [mine] };
}

/**
 * PUT /api/exams/report-cards/comments
 * Body: { studentId, year, term, classTeacherComment?, headComment? }
 * The class teacher writes their comment; ADMIN writes either.
 */
export async function saveReportComment(req) {
  const schoolId = req.schoolId;
  const studentId = assertCuid("studentId", req.body?.studentId);
  const year = assertInt("year", req.body?.year);
  const term = String(req.body?.term || "");
  assertTerm(term);

  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { classId: true } });
  if (!student) throw httpError(404, "Student not found.");

  const data = {};
  const clean = (v) => (v == null ? null : String(v).trim().slice(0, 600) || null);
  if ("classTeacherComment" in (req.body || {})) data.classTeacherComment = clean(req.body.classTeacherComment);
  if ("headComment" in (req.body || {})) data.headComment = clean(req.body.headComment);
  if (!Object.keys(data).length) throw httpError(400, "Nothing to save.");

  if (req.user.role === "TEACHER") {
    if ("headComment" in data) throw httpError(403, "Only an admin can write the head teacher's comment.");
    const isClassTeacher = await prisma.classTeacher.findFirst({
      where: { schoolId, classId: student.classId || "__none__", teacherId: req.user.teacherId || "__none__", isActive: true },
      select: { id: true },
    });
    if (!isClassTeacher) throw httpError(403, "Only the class teacher can comment on this learner.");
  }

  const saved = await prisma.reportCardComment.upsert({
    where: { schoolId_studentId_year_term: { schoolId, studentId, year, term } },
    create: { schoolId, studentId, year, term, ...data, updatedById: req.user.id },
    update: { ...data, updatedById: req.user.id },
  });
  return { classTeacher: saved.classTeacherComment || "", head: saved.headComment || "" };
}
