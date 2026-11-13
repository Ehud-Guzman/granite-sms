// Result slip and report card as one-page PDF downloads.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s, sessionId;

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;

beforeEach(async () => {
  s = await makeSchool();
  // Many subjects, to prove the slip still fits one page.
  const subjects = [];
  for (const name of ["Mathematics", "English", "Kiswahili", "Integrated Science", "Social Studies", "Agriculture", "Creative Arts", "CRE", "Pre-Technical Studies", "Health Education", "Business Studies", "Computer Science", "French", "Music"]) {
    const sub = await prisma.subject.create({ data: { schoolId: s.school.id, name } });
    await prisma.teachingAssignment.create({ data: { schoolId: s.school.id, classId: s.klass.id, subjectId: sub.id, teacherId: s.teacher.teacherId, isActive: true } });
    subjects.push(sub);
  }
  const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "End term" } });
  sessionId = (await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id })).body.data.id;
  for (const ms of await prisma.markSheet.findMany({ where: { examSessionId: sessionId } })) {
    await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: [70, 60, 50][i] })) });
    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
  }
  await as(s.admin).post(`/api/exams/sessions/${sessionId}/publish`).send({});
});

describe("PDF downloads", () => {
  it("gives a learner their own result slip on one page, and nobody else's", async () => {
    const mine = await as(s.studentUser).get(`/api/exams/sessions/${sessionId}/results/students/${s.students[0].id}/pdf`).buffer(true).parse(binary);
    expect(mine.status).toBe(200);
    expect(mine.headers["content-type"]).toMatch(/application\/pdf/);
    expect(mine.headers["content-disposition"]).toMatch(/attachment; filename="result-slip-Student1-Test-/);
    expect(mine.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(mine.body)).toBe(1);

    const other = await as(s.studentUser).get(`/api/exams/sessions/${sessionId}/results/students/${s.students[1].id}/pdf`);
    expect(other.status).toBe(403);
  });

  it("gives the term report card on one page", async () => {
    const r = await as(s.studentUser).get(`/api/exams/report-cards/students/${s.students[0].id}/pdf?year=2026&term=TERM1`).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/report-card-Student1-Test-TERM1-2026\.pdf/);
    expect(pages(r.body)).toBe(1);
    expect((await as(s.studentUser).get(`/api/exams/report-cards/students/${s.students[2].id}/pdf?year=2026&term=TERM1`)).status).toBe(403);
  });

  it("prints a whole class, one page per learner, for staff only", async () => {
    const q = `?classId=${s.klass.id}&year=2026&term=TERM1`;
    const r = await as(s.teacher).get(`/api/exams/report-cards/pdf${q}`).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(pages(r.body)).toBe(s.students.length);
    expect((await as(s.studentUser).get(`/api/exams/report-cards/pdf${q}`)).status).toBe(403);
    expect((await as(s.teacher2).get(`/api/exams/report-cards/pdf${q}`)).status).toBe(403);
  });
});
