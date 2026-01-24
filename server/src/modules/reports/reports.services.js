// src/routes/reports/reports.services.js (or wherever it lives)
import { PrismaClient, ExamSessionStatus } from "@prisma/client";
import { getClassResults } from "../exams/exams.services.js"; // ✅ reuse your engine
import { assertCuid } from "../exams/exams.validators.js";

const prisma = new PrismaClient();

function safeName(st) {
  const first = st?.firstName || "";
  const last = st?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

function mean(nums) {
  if (!nums.length) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

export async function getClassPerformanceReport(req) {
  const schoolId = req.user.schoolId;
  const sessionId = assertCuid("sessionId", req.query?.sessionId);

  // 1) Validate session (tenant + published)
const session = await prisma.examSession.findFirst({
  where: { id: sessionId, schoolId },
  select: {
    id: true,
    name: true,
    year: true,
    term: true,
    status: true,
    classId: true,
    class: { select: { id: true, name: true, stream: true, year: true } }, // ✅ works now
    examType: { select: { id: true, name: true, code: true, weight: true } },
  },
});


  if (!session) throw new Error("ExamSession not found.");
  if (session.status !== ExamSessionStatus.PUBLISHED) {
    throw new Error("Report available only for PUBLISHED exam sessions.");
  }

  // 1b) Fetch class info separately (because ExamSession has no relation `class`)
  const klass = await prisma.class.findFirst({
    where: { id: session.classId, schoolId },
    select: { id: true, name: true, stream: true, year: true },
  });

  // 2) Reuse your existing class-results engine (same grading + ranking + missing policy)
  const classResults = await getClassResults({
    ...req,
    params: { id: sessionId },
  });

  const rows = classResults.results || [];
  const studentCount = rows.length;

  const averages = rows.map((r) => Number(r.average || 0));
  const classMean = mean(averages);

  // 3) Grade distribution
  const dist = new Map();
  for (const r of rows) {
    const g = r.overallGrade || "N/A";
    dist.set(g, (dist.get(g) || 0) + 1);
  }

  const gradeDistribution = [...dist.entries()]
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => String(a.grade).localeCompare(String(b.grade)));

  // 4) Pass/fail (MVP rule): average >= 50
  const passThreshold = 50;
  let passCount = 0;
  for (const r of rows) if (Number(r.average || 0) >= passThreshold) passCount += 1;
  const failCount = studentCount - passCount;

  // 5) Ranking table
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
    class: klass, // ✅ now comes from Class table
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
    },
    ranking,
  };
}
