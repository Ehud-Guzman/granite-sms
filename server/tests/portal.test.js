// M15 / missing feature 9: parent logins and the learner/parent home.
import { describe, it, expect, beforeEach } from "vitest";
import { as, app, request, prisma, makeSchool } from "./helpers.js";

let s, mum, parent, local, phone;
// Login ids are unique across the database, so each test gets its own number.
const newPhone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function parentLogin() {
  const r = await as(s.admin).post(`/api/guardians/${mum.id}/login`).send({});
  expect(r.status).toBe(201);
  // First sign-in with the phone number as typed, then the forced password change.
  const spaced = `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  const first = await request(app).post("/api/auth/login").send({ email: spaced, password: r.body.tempPassword });
  expect(first.status).toBe(200);
  expect(first.body.user.mustChangePassword).toBe(true);
  await request(app)
    .post("/api/auth/change-password")
    .set("Authorization", `Bearer ${first.body.token}`)
    .send({ currentPassword: r.body.tempPassword, newPassword: "Parent123!" });
  const again = await request(app).post("/api/auth/login").send({ email: phone, password: "Parent123!" });
  expect(again.status).toBe(200);
  return { token: again.body.token, loginId: r.body.loginId };
}
const get = (url) => request(app).get(url).set("Authorization", `Bearer ${parent.token}`);

beforeEach(async () => {
  s = await makeSchool();
  local = newPhone();
  phone = `+254${local.slice(1)}`;
  mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone } });
  for (const st of [s.students[0], s.students[1]]) {
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: st.id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
  }
  parent = await parentLogin();
});

describe("parent login", () => {
  it("is created from the guardian and signs in with the phone number", async () => {
    expect(parent.loginId).toBe(phone);
    const u = await prisma.user.findUnique({ where: { email: phone } });
    expect(u.role).toBe("PARENT");
    expect((await as(s.admin).post(`/api/guardians/${mum.id}/login`).send({})).status).toBe(409);
    expect((await as(s.bursar).post(`/api/guardians/${mum.id}/login`).send({})).status).toBe(403);
  });
});

describe("parent home", () => {
  it("lists only the parent's own children with their fee account", async () => {
    const r = await get("/api/portal/learners");
    expect(r.status).toBe(200);
    expect(r.body.learners.map((l) => l.student.admissionNo).sort()).toEqual(["ADM-1", "ADM-2"]);
    const amani = r.body.learners.find((l) => l.student.admissionNo === "ADM-1");
    expect(amani.account).toEqual({ owed: 17000, credit: 0, net: 17000 });
  });

  it("opens their children's statements but nobody else's", async () => {
    expect((await get(`/api/fees/students/${s.students[0].id}/statement`)).status).toBe(200);
    expect((await get(`/api/fees/students/${s.students[2].id}/statement`)).status).toBe(403);
    const other = await makeSchool();
    expect((await get(`/api/fees/students/${other.students[0].id}/statement`)).status).toBe(403); // not linked, whether or not it exists
  });

  it("can't reach staff screens", async () => {
    for (const url of ["/api/students", "/api/fees/invoices", "/api/dashboard/summary", `/api/guardians/student/${s.students[0].id}`, "/api/users"]) {
      expect((await get(url)).status, url).toBe(403);
    }
  });

  it("sees a child's published report card, not another learner's", async () => {
    const maths = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Mathematics" } });
    await prisma.teachingAssignment.create({ data: { schoolId: s.school.id, classId: s.klass.id, subjectId: maths.id, teacherId: s.teacher.teacherId, isActive: true } });
    const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "End term" } });
    const sess = (await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id })).body.data;
    const ms = await prisma.markSheet.findFirst({ where: { examSessionId: sess.id } });
    await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: [70, 60, 50][i] })) });
    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
    await as(s.admin).post(`/api/exams/sessions/${sess.id}/publish`).send({});

    const mine = await get(`/api/exams/report-cards/students/${s.students[1].id}?year=2026&term=TERM1`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.students[0].student.admissionNo).toBe("ADM-2");
    expect((await get(`/api/exams/report-cards/students/${s.students[2].id}?year=2026&term=TERM1`)).status).toBe(403);

    const home = await get("/api/portal/learners");
    expect(home.body.learners.find((l) => l.student.admissionNo === "ADM-1").latestResult).toMatchObject({ average: 70, position: 1, outOf: 3 });
  });

  it("asks for M-Pesa set-up before offering to pay", async () => {
    const r = await request(app)
      .post(`/api/portal/learners/${s.students[0].id}/pay`)
      .set("Authorization", `Bearer ${parent.token}`)
      .send({ amount: 1000 });
    expect(r.status).toBe(400);
    const notMine = await request(app)
      .post(`/api/portal/learners/${s.students[2].id}/pay`)
      .set("Authorization", `Bearer ${parent.token}`)
      .send({ amount: 1000 });
    expect(notMine.status).toBe(403);
  });

  it("a learner's home shows only themselves", async () => {
    const r = await as(s.studentUser).get("/api/portal/learners");
    expect(r.body.learners.map((l) => l.student.admissionNo)).toEqual(["ADM-1"]);
  });
});
