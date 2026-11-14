// Feature 11: the timetable. Bell times, lessons, clash rules (class /
// teacher / room per slot, per academic year), weekly targets, auto-fill,
// who sees what, the lapsed-plan rule and the PDFs.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { readSetup, planLessons, slotKey, normaliseRoom } from "../src/modules/timetable/timetable.rules.js";

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("bell time rules", () => {
  const row = (label, startsAt, endsAt, kind = "LESSON") => ({ label, startsAt, endsAt, kind });
  it("sorts by time, numbers the periods and keeps breaks", () => {
    const r = readSetup({ days: [3, 1, 1, 2], periods: [row("2", "08:40", "09:20"), row("1", "08:00", "08:40"), row("Break", "09:20", "09:40", "BREAK")] });
    expect(r.days).toEqual([1, 2, 3]);
    expect(r.periods.map((p) => [p.position, p.label, p.kind])).toEqual([
      [1, "1", "LESSON"],
      [2, "2", "LESSON"],
      [3, "Break", "BREAK"],
    ]);
  });
  it("refuses bad days, bad times, overlaps and a day with no lessons", () => {
    const ok = [row("1", "08:00", "08:40")];
    expect(readSetup({ days: [], periods: ok }).error).toMatch(/school day/);
    expect(readSetup({ days: [7], periods: ok }).error).toMatch(/Monday/);
    expect(readSetup({ days: [1], periods: [row("1", "8:00", "08:40")] }).error).toMatch(/08:00/);
    expect(readSetup({ days: [1], periods: [row("1", "09:00", "08:40")] }).error).toMatch(/end after/);
    expect(readSetup({ days: [1], periods: [row("1", "08:00", "08:45"), row("2", "08:40", "09:20")] }).error).toMatch(/overlaps/);
    expect(readSetup({ days: [1], periods: [row("Break", "08:00", "08:40", "BREAK")] }).error).toMatch(/lessons/);
    expect(readSetup({ days: [1], periods: [row("", "08:00", "08:40")] }).error).toMatch(/name/);
  });
  it("treats rooms without case or spacing", () => {
    expect(normaliseRoom("  lab   1 ")).toBe("LAB 1");
    expect(normaliseRoom("  ")).toBeNull();
  });
});

describe("auto-fill planner", () => {
  const days = [1, 2, 3, 4, 5];
  const periods = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, position: n }));
  const plan = (needs, extra = {}) =>
    planLessons({ days, periods, needs, classBusy: new Set(), teacherBusy: new Map(), subjectDays: new Map(), ...extra });

  it("spreads a subject across the week, one a day where it can", () => {
    const { placed, unplaced } = plan([{ subjectId: "maths", teacherId: "t1", count: 5 }]);
    expect(unplaced).toEqual([]);
    expect(placed.map((p) => p.day).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("never puts a subject in one day three times, and says so when it can't place it", () => {
    const { placed, unplaced } = planLessons({ days: [1], periods, needs: [{ subjectId: "maths", teacherId: "t1", count: 4 }], classBusy: new Set(), teacherBusy: new Map(), subjectDays: new Map() });
    expect(placed).toHaveLength(2);
    expect(unplaced[0]).toMatchObject({ missing: 2, reason: expect.stringMatching(/third lesson/) });
  });

  it("works round a teacher who is busy elsewhere, and never double-books them", () => {
    const busy = new Map([["t1", new Set(days.flatMap((d) => [slotKey(d, "p1"), slotKey(d, "p2"), slotKey(d, "p3")]))]]);
    const { placed, unplaced } = plan([{ subjectId: "maths", teacherId: "t1", count: 5 }], { teacherBusy: busy });
    expect(unplaced).toEqual([]);
    expect(placed.every((p) => p.periodId === "p4")).toBe(true);
    // The busy map now holds the new lessons too, for the next class.
    expect(busy.get("t1").size).toBe(20);
  });

  it("fills a class without clashing it with itself, and is the same every time", () => {
    const needs = [
      { subjectId: "maths", teacherId: "t1", count: 6 },
      { subjectId: "eng", teacherId: "t2", count: 5 },
      { subjectId: "kis", teacherId: "t3", count: 5 },
      { subjectId: "sci", teacherId: "t1", count: 4 },
    ];
    const a = plan(needs.map((n) => ({ ...n })));
    const b = plan(needs.map((n) => ({ ...n })));
    expect(a).toEqual(b);
    const keys = a.placed.map((p) => slotKey(p.day, p.periodId));
    expect(new Set(keys).size).toBe(keys.length);
    expect(a.placed).toHaveLength(20); // exactly the 20 free slots
    const t1 = a.placed.filter((p) => p.teacherId === "t1").map((p) => slotKey(p.day, p.periodId));
    expect(new Set(t1).size).toBe(t1.length);
  });
});

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

let s, maths, eng, kis, aMaths, aEng, aKis, aMathsOther;
const BELL = {
  days: [1, 2, 3, 4, 5],
  periods: [
    { label: "1", startsAt: "08:00", endsAt: "08:40" },
    { label: "2", startsAt: "08:40", endsAt: "09:20" },
    { label: "Break", startsAt: "09:20", endsAt: "09:40", kind: "BREAK" },
    { label: "3", startsAt: "09:40", endsAt: "10:20" },
    { label: "4", startsAt: "10:20", endsAt: "11:00" },
  ],
};
let periods; // saved, with ids
const P = (label) => periods.find((p) => p.label === label).id;
const slot = (user, classId, body) => as(user).put(`/api/timetable/classes/${classId}/slot`).send(body);
const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;

beforeEach(async () => {
  s = await makeSchool();
  const sub = (name) => prisma.subject.create({ data: { schoolId: s.school.id, name } });
  [maths, eng, kis] = [await sub("Mathematics"), await sub("English"), await sub("Kiswahili")];
  const assign = (teacherId, classId, subjectId, lessonsPerWeek = null) =>
    prisma.teachingAssignment.create({ data: { schoolId: s.school.id, teacherId, classId, subjectId, isActive: true, lessonsPerWeek } });
  aMaths = await assign(s.teacher.teacherId, s.klass.id, maths.id);
  aEng = await assign(s.teacher.teacherId, s.klass.id, eng.id);
  aKis = await assign(s.teacher2.teacherId, s.klass.id, kis.id);
  aMathsOther = await assign(s.teacher.teacherId, s.otherClass.id, maths.id);
  const r = await as(s.admin).put("/api/timetable/setup").send(BELL);
  expect(r.status).toBe(200);
  periods = r.body.periods;
});

describe("bell times", () => {
  it("are saved in time order, readable by everyone, changed by admins only", async () => {
    expect(periods.map((p) => p.label)).toEqual(["1", "2", "Break", "3", "4"]);
    expect((await as(s.studentUser).get("/api/timetable/setup")).body.days).toEqual([1, 2, 3, 4, 5]);
    expect((await as(s.teacher).put("/api/timetable/setup").send(BELL)).status).toBe(403);
    expect((await as(s.admin).put("/api/timetable/setup").send({ ...BELL, days: [] })).status).toBe(400);
  });

  it("keep lessons on their period when times change, and ask before removing lessons", async () => {
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("3"), subjectId: maths.id })).status).toBe(200);

    // Moving period 3 later keeps its lesson.
    const moved = periods.map((p) => ({ ...p, ...(p.label === "3" ? { startsAt: "09:45", endsAt: "10:20" } : {}) }));
    expect((await as(s.admin).put("/api/timetable/setup").send({ days: BELL.days, periods: moved })).status).toBe(200);
    expect(await prisma.lesson.count({ where: { classId: s.klass.id, periodId: P("3") } })).toBe(1);

    // Taking the period out would lose the lesson: refused until confirmed.
    const without = periods.filter((p) => p.label !== "3");
    const ask = await as(s.admin).put("/api/timetable/setup").send({ days: BELL.days, periods: without });
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ code: "TIMETABLE_HAS_LESSONS", lessons: 1 });
    expect(await prisma.lesson.count({ where: { classId: s.klass.id } })).toBe(1);
    const yes = await as(s.admin).put("/api/timetable/setup").send({ days: BELL.days, periods: without, removeLessons: true });
    expect(yes.status).toBe(200);
    expect(yes.body.removedLessons).toBe(1);
    expect(await prisma.lesson.count({ where: { classId: s.klass.id } })).toBe(0);
  });

  it("ask before dropping a day or turning a lesson period into a break", async () => {
    await slot(s.admin, s.klass.id, { day: 5, periodId: P("1"), subjectId: maths.id });
    expect((await as(s.admin).put("/api/timetable/setup").send({ ...BELL, periods, days: [1, 2, 3, 4] })).status).toBe(409);
    const toBreak = periods.map((p) => (p.label === "1" ? { ...p, kind: "BREAK" } : p));
    expect((await as(s.admin).put("/api/timetable/setup").send({ days: BELL.days, periods: toBreak })).status).toBe(409);
  });
});

describe("placing lessons", () => {
  it("picks the assigned teacher, and refuses breaks, unassigned subjects and other teachers", async () => {
    const r = await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id, room: " lab 1 " });
    expect(r.status).toBe(200);
    expect(r.body.lesson).toMatchObject({ teacherId: s.teacher.teacherId, room: "LAB 1", year: 2026 });

    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("Break"), subjectId: maths.id })).status).toBe(400);
    const science = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Science" } });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: science.id })).body.message).toMatch(/No teacher is assigned/);
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: maths.id, teacherId: s.teacher2.teacherId })).status).toBe(400);
    expect((await slot(s.admin, s.klass.id, { day: 6, periodId: P("2"), subjectId: maths.id })).status).toBe(400);
  });

  it("refuses to put a teacher or a room in two places at once, naming the clash", async () => {
    await slot(s.admin, s.otherClass.id, { day: 2, periodId: P("1"), subjectId: maths.id, room: "LAB 1" });
    const t = await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: eng.id });
    expect(t.status).toBe(409);
    expect(t.body.code).toBe("TEACHER_CLASH");
    expect(t.body.message).toMatch(/Grade 8 E/);
    const room = await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: kis.id, room: "lab 1" });
    expect(room.status).toBe(409);
    expect(room.body.code).toBe("ROOM_CLASH");
    expect((await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: kis.id, room: "Lab 2" })).status).toBe(200);
  });

  it("replaces and clears a slot", async () => {
    await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: maths.id });
    expect((await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: kis.id })).body.lesson.subjectId).toBe(kis.id);
    expect(await prisma.lesson.count({ where: { classId: s.klass.id } })).toBe(1);
    expect((await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: null })).body).toEqual({ cleared: true });
    expect(await prisma.lesson.count({ where: { classId: s.klass.id } })).toBe(0);
  });

  it("lets last year's timetable stand without clashing with this year's", async () => {
    const old = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 6", stream: "E", year: 2025 } });
    await prisma.lesson.create({ data: { schoolId: s.school.id, classId: old.id, year: 2025, day: 1, periodId: P("1"), subjectId: maths.id, teacherId: s.teacher.teacherId } });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(200);
  });

  it("has the database itself refuse a double-booked teacher (two saves at once)", async () => {
    const base = { schoolId: s.school.id, year: 2026, day: 4, periodId: P("4"), subjectId: maths.id, teacherId: s.teacher.teacherId };
    await prisma.lesson.create({ data: { ...base, classId: s.klass.id } });
    await expect(prisma.lesson.create({ data: { ...base, classId: s.otherClass.id } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps schools apart", async () => {
    const other = await makeSchool();
    expect((await slot(s.admin, other.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(404);
    expect((await as(other.admin).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(404);
  });
});

describe("targets, warnings and auto-fill", () => {
  it("shows what's short, previews without saving, then fills without clashes", async () => {
    const t = await as(s.admin)
      .put(`/api/timetable/classes/${s.klass.id}/targets`)
      .send({ items: [{ assignmentId: aMaths.id, lessonsPerWeek: 5 }, { assignmentId: aEng.id, lessonsPerWeek: 4 }, { assignmentId: aKis.id, lessonsPerWeek: 4 }] });
    expect(t.status).toBe(200);
    expect(t.body.warnings.filter((w) => w.kind === "SHORT")).toHaveLength(3);
    await as(s.admin).put(`/api/timetable/classes/${s.otherClass.id}/targets`).send({ items: [{ assignmentId: aMathsOther.id, lessonsPerWeek: 5 }] });
    expect((await as(s.admin).put(`/api/timetable/classes/${s.klass.id}/targets`).send({ items: [{ assignmentId: aMaths.id, lessonsPerWeek: 99 }] })).status).toBe(400);
    expect((await as(s.admin).put(`/api/timetable/classes/${s.klass.id}/targets`).send({ items: [{ assignmentId: aMathsOther.id, lessonsPerWeek: 3 }] })).status).toBe(400);

    const preview = await as(s.admin).get("/api/timetable/autofill?year=2026");
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ applied: false, placed: 18, unplaced: 0 });
    expect(await prisma.lesson.count({ where: { schoolId: s.school.id } })).toBe(0);

    const apply = await as(s.admin).post("/api/timetable/autofill").send({ year: 2026 });
    expect(apply.status).toBe(200);
    const lessons = await prisma.lesson.findMany({ where: { schoolId: s.school.id } });
    expect(lessons).toHaveLength(18);
    // The shared teacher (maths in both classes, English) is never in two places.
    const t1 = lessons.filter((l) => l.teacherId === s.teacher.teacherId).map((l) => slotKey(l.day, l.periodId));
    expect(new Set(t1).size).toBe(t1.length);
    // No subject three times in a day.
    const perDay = new Map();
    for (const l of lessons) perDay.set(`${l.classId}|${l.subjectId}|${l.day}`, (perDay.get(`${l.classId}|${l.subjectId}|${l.day}`) || 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);

    const after = await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`);
    expect(after.body.warnings).toEqual([]);
    expect(after.body.load.find((a) => a.subjectId === maths.id)).toMatchObject({ lessonsPerWeek: 5, placed: 5 });
    // Running it again places nothing new.
    expect((await as(s.admin).get("/api/timetable/autofill?year=2026")).body.placed).toBe(0);
  });

  it("is for admins only", async () => {
    expect((await as(s.teacher).get("/api/timetable/autofill?year=2026")).status).toBe(403);
    expect((await as(s.teacher).post("/api/timetable/autofill").send({})).status).toBe(403);
  });
});

describe("who sees what", () => {
  beforeEach(async () => {
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    await slot(s.admin, s.otherClass.id, { day: 1, periodId: P("2"), subjectId: maths.id });
  });

  it("teachers see classes and their own week, not a colleague's", async () => {
    const mine = await as(s.teacher).get("/api/timetable/me");
    expect(mine.body.kind).toBe("teacher");
    expect(mine.body.lessons.map((l) => l.class.label).sort()).toEqual(["Grade 7 E", "Grade 8 E"]);
    expect((await as(s.teacher).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(200);
    expect((await as(s.teacher).get(`/api/timetable/teachers/${s.teacher2.teacherId}`)).status).toBe(403);
    expect((await as(s.admin).get(`/api/timetable/teachers/${s.teacher2.teacherId}`)).status).toBe(200);
  });

  it("a learner sees only their own class's week, without the planning details", async () => {
    const own = await as(s.studentUser).get(`/api/timetable/classes/${s.klass.id}`);
    expect(own.status).toBe(200);
    expect(own.body.load).toBeUndefined();
    expect(own.body.lessons).toHaveLength(1);
    expect((await as(s.studentUser).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(403);
    expect((await as(s.bursar).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(403);
    const me = await as(s.studentUser).get("/api/timetable/me");
    expect(me.body.learners[0].timetable.lessons).toHaveLength(1);
  });

  it("a parent sees each child's class", async () => {
    const user = await prisma.user.create({ data: { email: `+2547${Date.now() % 1e8}`, password: "x", role: "PARENT", schoolId: s.school.id, isActive: true, mustChangePassword: false } });
    const mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: user.email, userId: user.id } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[1].id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
    const me = await as(user).get("/api/timetable/me");
    expect(me.status).toBe(200);
    expect(me.body.learners.map((l) => l.learner.name)).toEqual(["Student2 Test"]);
    expect((await as(user).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(200);
    expect((await as(user).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(403);
  });

  it("today lists the caller's lessons for today's weekday", async () => {
    const r = await as(s.teacher).get("/api/timetable/today");
    expect(r.status).toBe(200);
    expect(r.body.now).toMatch(/^\d\d:\d\d$/);
    // Only Monday has lessons in this test.
    expect(r.body.lessons).toHaveLength(r.body.day === 1 ? 2 : 0);
    const learner = await as(s.studentUser).get("/api/timetable/today");
    expect(learner.body.learners[0].lessons).toHaveLength(learner.body.day === 1 ? 1 : 0);
  });

  it("prints a class or a teacher on one landscape page", async () => {
    const c = await as(s.studentUser).get(`/api/timetable/classes/${s.klass.id}/pdf`).buffer(true).parse(binary);
    expect(c.status).toBe(200);
    expect(c.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pages(c.body)).toBe(1);
    const t = await as(s.teacher).get(`/api/timetable/teachers/${s.teacher.teacherId}/pdf`).buffer(true).parse(binary);
    expect(t.status).toBe(200);
    expect(pages(t.body)).toBe(1);
    expect((await as(s.studentUser).get(`/api/timetable/classes/${s.otherClass.id}/pdf`)).status).toBe(403);
  });
});

describe("lapsed plan", () => {
  it("keeps the timetable readable but refuses changes", async () => {
    await prisma.subscription.updateMany({ where: { schoolId: s.school.id }, data: { currentPeriodEnd: new Date(Date.now() - 86400000) } });
    expect((await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(200);
    const r = await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    expect(r.status).toBe(402);
    expect((await as(s.admin).put("/api/timetable/setup").send(BELL)).status).toBe(402);
  });
});
