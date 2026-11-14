// src/modules/reports/reports.services.js
import { ExamSessionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { getClassResults } from "../exams/exams.services.js";
import { assertCuid } from "../exams/exams.validators.js";

function safeName(st) {
  const first = st?.firstName || "";
  const last = st?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Class performance report for a PUBLISHED exam session.
 * Reuses the canonical results engine (exams.services#getClassResults) for
 * totals/averages/grades/ranking instead of recomputing them — that math
 * lives in exactly one place now.
 */
export async function getClassPerformanceReport(req) {
  const schoolId = req.schoolId || req.user?.schoolId;
  const sessionId = assertCuid("sessionId", req.query?.sessionId);

  const session = await prisma.examSession.findFirst({
    where: { id: sessionId, schoolId },
    select: {
      id: true,
      name: true,
      year: true,
      term: true,
      status: true,
      classId: true,
      examType: { select: { id: true, name: true, code: true, weight: true } },
      // Fetched with the session rather than after it (one wait fewer).
      class: { select: { id: true, name: true, stream: true, year: true, schoolId: true } },
    },
  });

  if (!session) throw Object.assign(new Error("ExamSession not found."), { statusCode: 404 });
  if (session.status !== ExamSessionStatus.PUBLISHED) {
    throw Object.assign(
      new Error("Report available only for PUBLISHED exam sessions."),
      { statusCode: 400 }
    );
  }

  const { schoolId: classSchoolId, ...classRow } = session.class || {};
  const klass = session.class && classSchoolId === schoolId ? classRow : null;

  // Reuse the same engine the class-results screen uses (spoof req.params.id
  // the way this call site already relied on before — same technique, now
  // pointed at a service that returns the shape we actually need).
  const classResults = await getClassResults({
    ...req,
    params: { id: sessionId },
  });

  const rows = classResults.results || [];
  const studentCount = rows.length;
  const classMean = Number(mean(rows.map((r) => r.average)).toFixed(2));

  const dist = new Map();
  for (const r of rows) {
    const g = r.overallGrade || "N/A";
    dist.set(g, (dist.get(g) || 0) + 1);
  }
  const gradeDistribution = [...dist.entries()]
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => String(a.grade).localeCompare(String(b.grade)));

  const passThreshold = 50;
  const passCount = rows.filter((r) => Number(r.average || 0) >= passThreshold).length;
  const failCount = studentCount - passCount;

  // Each subject's class average, strongest first (only learners with a mark count).
  const bySubject = new Map();
  for (const r of rows) {
    for (const s of r.subjectScores || []) {
      if (s.score == null) continue;
      const x = bySubject.get(s.subjectId) || { subjectId: s.subjectId, subjectName: s.subjectName || "Subject", sum: 0, count: 0 };
      x.sum += Number(s.score);
      x.count += 1;
      bySubject.set(s.subjectId, x);
    }
  }
  const subjectMeans = [...bySubject.values()]
    .map((x) => ({ subjectId: x.subjectId, subjectName: x.subjectName, mean: Number((x.sum / x.count).toFixed(1)), count: x.count }))
    .sort((a, b) => b.mean - a.mean);

  const ranking = rows.map((r) => ({
    studentId: r.student.id,
    admissionNo: r.student.admissionNo,
    name: safeName(r.student),
    total: r.total,
    average: r.average,
    grade: r.overallGrade,
    position: r.position,
  }));

  return {
    meta: {
      year: session.year,
      term: session.term,
      classId: session.classId,
      sessionId: session.id,
      computedAt: new Date().toISOString(),
      passThreshold,
    },
    class: klass,
    session: {
      id: session.id,
      name: session.name,
      year: session.year,
      term: session.term,
      status: session.status,
      examType: session.examType,
    },
    stats: {
      studentCount,
      classMean,
      gradeDistribution,
      passCount,
      failCount,
      subjectMeans,
    },
    ranking,
  };
}
