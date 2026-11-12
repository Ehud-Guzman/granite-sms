// Missing feature 7: end-of-year promotion and recording leavers.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s, g8next, g9next;
beforeEach(async () => {
  s = await makeSchool();
  // s.klass = Grade 7 E 2026 (3 learners); s.otherClass = Grade 8 E 2026 (2 learners added).
  for (let i = 0; i < 2; i++) {
    await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: `G8-${i}`, firstName: `Eight${i}`, lastName: "X", classId: s.otherClass.id },
    });
  }
  g8next = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 8", stream: "E", year: 2027 } });
  g9next = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 9", stream: "E", year: 2027 } });
});

const promote = (body, user = s.admin) => as(user).post("/api/classes/promote").send(body);

describe("promotion", () => {
  it("previews without changing anything", async () => {
    const r = await promote({ dryRun: true, moves: [{ fromClassId: s.klass.id, toClassId: g8next.id }, { fromClassId: s.otherClass.id, toClassId: null }] });
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual({ moved: 3, graduated: 2 });
    expect(await prisma.student.count({ where: { classId: s.klass.id, isActive: true } })).toBe(3);
  });

  it("moves classes and graduates leavers in one go", async () => {
    const r = await promote({
      exitDate: "2026-11-20",
      moves: [
        { fromClassId: s.klass.id, toClassId: g8next.id },
        { fromClassId: s.otherClass.id, toClassId: null },
      ],
    });
    expect(r.status).toBe(200);
    expect(await prisma.student.count({ where: { classId: g8next.id, isActive: true } })).toBe(3);
    const grads = await prisma.student.findMany({ where: { classId: s.otherClass.id } });
    expect(grads.every((g) => !g.isActive && g.exitStatus === "GRADUATED")).toBe(true);
    expect(grads[0].exitDate.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("handles a chain where a destination is also a source", async () => {
    // 2026 Grade 8 -> 2027 Grade 9, and 2027 Grade 8 (already holding someone) isn't touched;
    // here: 7E(2026) -> 8E(2026 otherClass)  while  8E(2026) -> 9E(2027)
    const r = await promote({
      moves: [
        { fromClassId: s.klass.id, toClassId: s.otherClass.id },
        { fromClassId: s.otherClass.id, toClassId: g9next.id },
      ],
    });
    expect(r.status).toBe(200);
    expect(await prisma.student.count({ where: { classId: s.otherClass.id, isActive: true } })).toBe(3); // the old 7E
    expect(await prisma.student.count({ where: { classId: g9next.id, isActive: true } })).toBe(2); // the old 8E
  });

  it("refuses bad plans: back a year, into itself, twice, other school, non-admin", async () => {
    const past = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 6", stream: "E", year: 2025 } });
    expect((await promote({ moves: [{ fromClassId: s.klass.id, toClassId: past.id }] })).status).toBe(400);
    expect((await promote({ moves: [{ fromClassId: s.klass.id, toClassId: s.klass.id }] })).status).toBe(400);
    expect(
      (await promote({ moves: [{ fromClassId: s.klass.id, toClassId: g8next.id }, { fromClassId: s.klass.id, toClassId: g9next.id }] })).status
    ).toBe(400);
    const other = await makeSchool();
    expect((await promote({ moves: [{ fromClassId: other.klass.id, toClassId: g8next.id }] })).status).toBe(400);
    expect((await promote({ moves: [{ fromClassId: s.klass.id, toClassId: g8next.id }] }, s.teacher)).status).toBe(403);
  });
});

describe("leavers", () => {
  it("records a transfer and clears it if the learner comes back", async () => {
    const id = s.students[1].id;
    const r = await as(s.admin).patch(`/api/students/${id}/exit`).send({ status: "TRANSFERRED", date: "2026-09-01", note: "Moved to Nakuru" });
    expect(r.status).toBe(200);
    expect(r.body.student).toMatchObject({ isActive: false, exitStatus: "TRANSFERRED", exitNote: "Moved to Nakuru" });

    const back = await as(s.admin).patch(`/api/students/${id}`).send({ isActive: true });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ isActive: true, exitStatus: null, exitNote: null });
  });

  it("validates the status", async () => {
    expect((await as(s.admin).patch(`/api/students/${s.students[1].id}/exit`).send({ status: "EXPELLED_FOREVER" })).status).toBe(400);
  });
});
