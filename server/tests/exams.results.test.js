// H9 (frozen published results), M9 (reads don't write), M8 (claiming), M7 (subject teachers).
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s, maths, english, session, sheets;

beforeEach(async () => {
  s = await makeSchool();
  maths = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Mathematics" } });
  english = await prisma.subject.create({ data: { schoolId: s.school.id, name: "English" } });
  // Tess teaches Maths, Tom teaches English; Tom is not class teacher.
  await prisma.teachingAssignment.createMany({
    data: [
      { schoolId: s.school.id, classId: s.klass.id, subjectId: maths.id, teacherId: s.teacher.teacherId, isActive: true },
      { schoolId: s.school.id, classId: s.klass.id, subjectId: english.id, teacherId: s.teacher2.teacherId, isActive: true },
    ],
  });
  const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "End term" } });
  const r = await as(s.admin)
    .post("/api/exams/sessions")
    .send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id, name: "End term 1" });
  expect(r.status).toBe(200);
  session = r.body.data;
  sheets = await prisma.markSheet.findMany({ where: { examSessionId: session.id }, include: { subject: true } });
});

const sheetFor = (subject) => sheets.find((m) => m.subjectId === subject.id);

async function enterAndSubmit(user, subject, scores) {
  const ms = sheetFor(subject);
  const put = await as(user)
    .put(`/api/exams/marksheets/${ms.id}/marks`)
    .send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: scores[i] })) });
  expect(put.status).toBe(200);
  const sub = await as(user).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
  expect(sub.status).toBe(200);
}

async function publishAll() {
  await enterAndSubmit(s.teacher, maths, [90, 60, 75]);
  await enterAndSubmit(s.teacher2, english, [80, 70, 75]);
  const pub = await as(s.admin).post(`/api/exams/sessions/${session.id}/publish`).send({});
  expect(pub.status).toBe(200);
}

describe("published results are frozen (H9)", () => {
  it("don't change when the class changes after publishing", async () => {
    await publishAll();
    const before = await as(s.admin).get(`/api/exams/sessions/${session.id}/results/class`);
    expect(before.body.data.frozen).toBe(true);
    expect(before.body.data.results.map((r) => [r.student.admissionNo, r.position, r.total])).toEqual([
      ["ADM-1", 1, 170],
      ["ADM-3", 2, 150],
      ["ADM-2", 3, 130],
    ]);

    // Afterwards: top student leaves, a new learner joins, a name is corrected.
    await prisma.student.update({ where: { id: s.students[0].id }, data: { isActive: false } });
    await prisma.student.update({ where: { id: s.students[1].id }, data: { firstName: "Renamed" } });
    await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: "ADM-9", firstName: "New", lastName: "Joiner", classId: s.klass.id },
    });

    const after = await as(s.admin).get(`/api/exams/sessions/${session.id}/results/class`);
    expect(after.body.data.results).toEqual(before.body.data.results);
  });

  it("gives a student their frozen slip with position out of class size", async () => {
    await publishAll();
    const r = await as(s.studentUser).get(`/api/exams/sessions/${session.id}/results/students/${s.students[0].id}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ frozen: true, total: 170, position: 1, outOf: 3 });
    expect(r.body.data.subjectScores.map((x) => x.subjectName)).toEqual(["English", "Mathematics"]);
  });

  it("can be unpublished with a reason, corrected and republished", async () => {
    await publishAll();
    const noReason = await as(s.admin).post(`/api/exams/sessions/${session.id}/unpublish`).send({});
    expect(noReason.status).toBe(400);
    const teacherTry = await as(s.teacher).post(`/api/exams/sessions/${session.id}/unpublish`).send({ reason: "x" });
    expect(teacherTry.status).toBe(403);

    const un = await as(s.admin).post(`/api/exams/sessions/${session.id}/unpublish`).send({ reason: "Maths mark for ADM-2 wrong" });
    expect(un.status).toBe(200);
    expect(await prisma.resultPublish.count({ where: { examSessionId: session.id } })).toBe(0);

    const ms = sheetFor(maths);
    expect((await as(s.admin).post(`/api/exams/marksheets/${ms.id}/unlock`).send({ reason: "fix ADM-2" })).status).toBe(200);
    await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: [{ studentId: s.students[1].id, score: 95 }] });
    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
    expect((await as(s.admin).post(`/api/exams/sessions/${session.id}/publish`).send({})).status).toBe(200);

    const r = await as(s.admin).get(`/api/exams/sessions/${session.id}/results/class`);
    // ADM-2 corrected from 60 to 95 in Maths: 165, now second behind ADM-1 (170).
    expect(r.body.data.results.find((x) => x.student.admissionNo === "ADM-2")).toMatchObject({ total: 165, position: 2 });
    expect(r.body.data.results[0]).toMatchObject({ total: 170, position: 1 });
  });
});

describe("reading results writes nothing (M9)", () => {
  it("live results include a new learner without creating mark rows", async () => {
    await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: "ADM-8", firstName: "Late", lastName: "Comer", classId: s.klass.id },
    });
    const before = await prisma.mark.count({ where: { markSheet: { examSessionId: session.id } } });
    const r = await as(s.admin).get(`/api/exams/sessions/${session.id}/results/class`);
    expect(r.body.data.frozen).toBe(false);
    expect(r.body.data.results.map((x) => x.student.admissionNo)).toContain("ADM-8");
    expect(await prisma.mark.count({ where: { markSheet: { examSessionId: session.id } } })).toBe(before);
  });
});

describe("unassigned marksheets (M8)", () => {
  beforeEach(async () => {
    await prisma.markSheet.update({ where: { id: sheetFor(maths).id }, data: { teacherId: null } });
  });

  it("only a teacher of that subject can open or claim it", async () => {
    const ms = sheetFor(maths);
    expect((await as(s.teacher2).get(`/api/exams/marksheets/${ms.id}`)).status).toBe(403);
    const put = await as(s.teacher2)
      .put(`/api/exams/marksheets/${ms.id}/marks`)
      .send({ marks: [{ studentId: s.students[0].id, score: 1 }] });
    expect(put.status).toBe(403);
    const list = await as(s.teacher2).get(`/api/exams/sessions/${session.id}/marksheets`);
    expect(list.body.data.markSheets.map((m) => m.subjectId)).toEqual([english.id]);

    const ok = await as(s.teacher)
      .put(`/api/exams/marksheets/${ms.id}/marks`)
      .send({ marks: [{ studentId: s.students[0].id, score: 50 }] });
    expect(ok.status).toBe(200);
    expect((await prisma.markSheet.findUnique({ where: { id: ms.id } })).teacherId).toBe(s.teacher.teacherId);
  });
});

describe("subject teachers see their students (M7)", () => {
  it("lists the class for a teacher who only teaches a subject in it", async () => {
    const r = await as(s.teacher2).get("/api/students");
    expect(r.status).toBe(200);
    expect(r.body.map((x) => x.admissionNo).sort()).toEqual(["ADM-1", "ADM-2", "ADM-3"]);
    expect((await as(s.teacher2).get(`/api/students/${s.students[0].id}`)).status).toBe(200);
  });
});
