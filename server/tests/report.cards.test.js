// Missing feature 6: term report cards combining a term's published exams.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s, maths;

async function examWith(typeName, weight, scores, { publish = true } = {}) {
  const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: typeName, weight } });
  const r = await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id, name: typeName });
  const sess = r.body.data;
  const ms = await prisma.markSheet.findFirst({ where: { examSessionId: sess.id } });
  await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: scores[i] })) });
  if (publish) {
    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
    expect((await as(s.admin).post(`/api/exams/sessions/${sess.id}/publish`).send({})).status).toBe(200);
  }
  return sess;
}

beforeEach(async () => {
  s = await makeSchool();
  maths = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Mathematics" } });
  await prisma.teachingAssignment.create({ data: { schoolId: s.school.id, classId: s.klass.id, subjectId: maths.id, teacherId: s.teacher.teacherId, isActive: true } });
});

const report = (user = s.admin) => as(user).get(`/api/exams/report-cards?classId=${s.klass.id}&year=2026&term=TERM1`);

describe("term report cards", () => {
  it("combines published exams by weight and ranks the class", async () => {
    await examWith("CAT", 0.3, [50, 90, 60]);
    await examWith("End term", 0.7, [80, 70, 60]);
    await examWith("Mock (not published)", 1, [0, 0, 0], { publish: false });

    const r = await report();
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.sessions.map((x) => x.name)).toEqual(["CAT", "End term"]); // unpublished left out
    const byAdm = Object.fromEntries(d.students.map((x) => [x.student.admissionNo, x]));
    expect(byAdm["ADM-1"].subjects[0].termScore).toBe(71); // 50*0.3 + 80*0.7
    expect(byAdm["ADM-2"].subjects[0].termScore).toBe(76); // 90*0.3 + 70*0.7
    expect(byAdm["ADM-3"].subjects[0].termScore).toBe(60);
    expect([byAdm["ADM-2"].position, byAdm["ADM-1"].position, byAdm["ADM-3"].position]).toEqual([1, 2, 3]);
    expect(byAdm["ADM-1"].overallGrade).toBe("B+"); // built-in A-E: 71
  });

  it("includes the term's attendance", async () => {
    await examWith("End term", null, [80, 70, 60]);
    const sess = await prisma.attendanceSession.create({
      data: { schoolId: s.school.id, classId: s.klass.id, date: new Date("2026-02-02T00:00:00Z"), year: 2026, term: "TERM1", takenByUserId: s.teacher.id, status: "SUBMITTED" },
    });
    await prisma.attendanceRecord.createMany({
      data: [
        { schoolId: s.school.id, sessionId: sess.id, studentId: s.students[0].id, status: "PRESENT" },
        { schoolId: s.school.id, sessionId: sess.id, studentId: s.students[1].id, status: "ABSENT" },
      ],
    });
    const d = (await report()).body.data;
    const a = Object.fromEntries(d.students.map((x) => [x.student.admissionNo, x.attendance]));
    expect(a["ADM-1"]).toMatchObject({ present: 1, total: 1, ratePct: 100 });
    expect(a["ADM-2"]).toMatchObject({ absent: 1, ratePct: 0 });
  });

  it("class teacher writes their comment; only admins write the head's", async () => {
    await examWith("End term", null, [80, 70, 60]);
    const body = { studentId: s.students[0].id, year: 2026, term: "TERM1" };
    expect((await as(s.teacher).put("/api/exams/report-cards/comments").send({ ...body, classTeacherComment: "Steady progress." })).status).toBe(200);
    expect((await as(s.teacher).put("/api/exams/report-cards/comments").send({ ...body, headComment: "x" })).status).toBe(403);
    expect((await as(s.teacher2).put("/api/exams/report-cards/comments").send({ ...body, classTeacherComment: "x" })).status).toBe(403);
    expect((await as(s.admin).put("/api/exams/report-cards/comments").send({ ...body, headComment: "Well done." })).status).toBe(200);
    const mine = (await report()).body.data.students.find((x) => x.student.id === s.students[0].id);
    expect(mine.comments).toEqual({ classTeacher: "Steady progress.", head: "Well done." });
  });

  it("a learner sees only their own card, with position in class", async () => {
    await examWith("End term", null, [80, 70, 60]);
    const own = await as(s.studentUser).get(`/api/exams/report-cards/students/${s.students[0].id}?year=2026&term=TERM1`);
    expect(own.status).toBe(200);
    expect(own.body.data.students).toHaveLength(1);
    expect(own.body.data.students[0]).toMatchObject({ position: 1 });
    expect(own.body.data.outOf).toBe(3);
    expect((await as(s.studentUser).get(`/api/exams/report-cards/students/${s.students[1].id}?year=2026&term=TERM1`)).status).toBe(403);
    expect((await as(s.studentUser).get(`/api/exams/report-cards?classId=${s.klass.id}&year=2026&term=TERM1`)).status).toBe(403);
  });
});
