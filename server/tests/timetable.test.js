// Feature 11: the timetable. School days and bell schedules, lessons and every
// clash rule (class / group, teacher, room, unavailable times, daily maximum,
// across schedules by time), split and combined lessons, move/swap, targets,
// doubles, rooms and option blocks in auto-fill, copy forward, who sees what,
// the lapsed-plan rule, PDFs and two saves racing.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { readSchedule, lessonSlots, planLessons, overlaps, slotKey } from "../src/modules/timetable/timetable.rules.js";

const row = (label, startsAt, endsAt, kind = "LESSON", days = []) => ({ label, startsAt, endsAt, kind, days });

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("bell time rules", () => {
  it("sorts, numbers, and lets day-limited periods share a time on different days", () => {
    const r = readSchedule({ name: "Day", periods: [row("2", "08:40", "09:20"), row("1", "08:00", "08:40"), row("Clubs", "14:00", "15:00", "LESSON", [5]), row("7", "14:00", "14:40", "LESSON", [1, 2, 3, 4])] });
    expect(r.periods.map((p) => [p.position, p.label])).toEqual([[1, "1"], [2, "2"], [3, "Clubs"], [4, "7"]]);
  });
  it("refuses overlaps on the same day, bad times and a day with no lessons", () => {
    expect(readSchedule({ name: "D", periods: [row("1", "08:00", "08:45"), row("2", "08:40", "09:20")] }).error).toMatch(/overlaps/);
    expect(readSchedule({ name: "D", periods: [row("1", "8:00", "08:40")] }).error).toMatch(/08:00/);
    expect(readSchedule({ name: "D", periods: [row("B", "08:00", "08:40", "BREAK")] }).error).toMatch(/lessons/);
    expect(readSchedule({ name: "", periods: [row("1", "08:00", "08:40")] }).error).toMatch(/name/);
  });
  it("knows which lesson periods are back to back (for doubles)", () => {
    const periods = readSchedule({ name: "D", periods: [row("1", "08:00", "08:40"), row("2", "08:40", "09:20"), row("B", "09:20", "09:40", "BREAK"), row("3", "09:40", "10:20")] }).periods.map((p, i) => ({ ...p, id: `p${i + 1}` }));
    const slots = lessonSlots([1], periods);
    expect(slots.map((s) => s.nextPeriodId)).toEqual(["p2", null, null]);
    expect(overlaps("08:00", "08:40", "08:39", "09:00")).toBe(true);
    expect(overlaps("08:00", "08:40", "08:40", "09:00")).toBe(false);
  });
});

describe("auto-fill planner", () => {
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const periods = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, position: n, label: String(n), startsAt: hhmm(440 + n * 40), endsAt: hhmm(480 + n * 40), kind: "LESSON" }));
  const slots = lessonSlots([1, 2, 3, 4, 5], periods);
  const run = (needs, busy = new Set()) => {
    const taken = new Set(busy);
    return planLessons({ slots, needs, isFree: (n, s) => !taken.has(slotKey(s.day, s.periodId)), take: (n, s) => taken.add(slotKey(s.day, s.periodId)) });
  };
  it("spreads a subject one a day, never three in a day, and is repeatable", () => {
    const a = run([{ key: "maths", count: 5 }]);
    expect(a.placed.map((p) => p.day).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(run([{ key: "maths", count: 5 }])).toEqual(a);
    const one = planLessons({ slots: lessonSlots([1], periods), needs: [{ key: "m", count: 4 }], isFree: () => true, take: () => {} });
    expect(one.placed).toHaveLength(2);
    expect(one.unplaced[0].reason).toMatch(/third lesson/);
  });
  it("places doubles back to back", () => {
    const { placed } = run([{ key: "sci", count: 4, doubles: 2 }]);
    const days = new Map();
    for (const p of placed) days.set(p.day, [...(days.get(p.day) || []), p.periodId]);
    const pairs = [...days.values()].filter((v) => v.length === 2);
    expect(pairs).toHaveLength(2);
    for (const [x, y] of pairs) expect(Math.abs(Number(x.slice(1)) - Number(y.slice(1)))).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

let s, maths, eng, kis, cre, ire, aMaths, aEng, aKis, aMathsOther, sched, periods;
const DAY = { name: "School day", periods: [row("1", "08:00", "08:40"), row("2", "08:40", "09:20"), row("Break", "09:20", "09:40", "BREAK"), row("3", "09:40", "10:20"), row("4", "10:20", "11:00")] };
const P = (label) => periods.find((p) => p.label === label).id;
const slot = (user, classId, body) => as(user).put(`/api/timetable/classes/${classId}/slot`).send(body);
const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;
const assign = (teacherId, classId, subjectId, extra = {}) => prisma.teachingAssignment.create({ data: { schoolId: s.school.id, teacherId, classId, subjectId, isActive: true, ...extra } });

beforeEach(async () => {
  s = await makeSchool();
  const sub = (name) => prisma.subject.create({ data: { schoolId: s.school.id, name } });
  [maths, eng, kis, cre, ire] = [await sub("Mathematics"), await sub("English"), await sub("Kiswahili"), await sub("CRE"), await sub("IRE")];
  aMaths = await assign(s.teacher.teacherId, s.klass.id, maths.id);
  aEng = await assign(s.teacher.teacherId, s.klass.id, eng.id);
  aKis = await assign(s.teacher2.teacherId, s.klass.id, kis.id);
  aMathsOther = await assign(s.teacher.teacherId, s.otherClass.id, maths.id);
  expect((await as(s.admin).put("/api/timetable/days").send({ days: [1, 2, 3, 4, 5] })).status).toBe(200);
  const setup = await as(s.admin).get("/api/timetable/setup");
  sched = setup.body.schedules[0];
  const r = await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send(DAY);
  expect(r.status).toBe(200);
  periods = r.body.periods;
});

describe("school days and bell schedules", () => {
  it("are readable by everyone, changed by admins only", async () => {
    const setup = await as(s.studentUser).get("/api/timetable/setup");
    expect(setup.body.days).toEqual([1, 2, 3, 4, 5]);
    expect(setup.body.schedules[0]).toMatchObject({ name: "School day", isDefault: true });
    expect((await as(s.teacher).put(`/api/timetable/schedules/${sched.id}`).send(DAY)).status).toBe(403);
    expect((await as(s.admin).put("/api/timetable/days").send({ days: [] })).status).toBe(400);
  });

  it("keep lessons when times change and ask before removing any (period, break, day, period days)", async () => {
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("3"), subjectId: maths.id });
    const moved = periods.map((p) => (p.label === "3" ? { ...p, startsAt: "09:45" } : p));
    expect((await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send({ name: "School day", periods: moved })).status).toBe(200);
    expect(await prisma.lesson.count({ where: { classId: s.klass.id } })).toBe(1);

    const without = periods.filter((p) => p.label !== "3");
    const ask = await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send({ name: "School day", periods: without });
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ code: "TIMETABLE_HAS_LESSONS", lessons: 1 });
    const onlyTue = periods.map((p) => (p.label === "3" ? { ...p, days: [2] } : p));
    expect((await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send({ name: "School day", periods: onlyTue })).status).toBe(409);
    expect((await as(s.admin).put("/api/timetable/days").send({ days: [2, 3] })).status).toBe(409);
    const yes = await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send({ name: "School day", periods: without, removeLessons: true });
    expect(yes.body.removedLessons).toBe(1);
  });

  it("runs a second school day for some classes; teacher clashes count by time across them", async () => {
    const upper = await as(s.admin).post("/api/timetable/schedules").send({ name: "Upper", periods: [row("1", "08:20", "09:00"), row("2", "09:00", "09:40")] });
    expect(upper.status).toBe(200);
    expect((await as(s.admin).put(`/api/timetable/classes/${s.otherClass.id}/schedule`).send({ scheduleId: upper.body.id })).status).toBe(200);
    // Teacher in Grade 7 at 08:00-08:40; Grade 8's 08:20-09:00 overlaps.
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(200);
    const clash = await slot(s.admin, s.otherClass.id, { day: 1, periodId: upper.body.periods[0].id, subjectId: maths.id });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("TEACHER_CLASH");
    // A Grade 7 period can't be used for Grade 8 any more.
    expect((await slot(s.admin, s.otherClass.id, { day: 1, periodId: P("3"), subjectId: maths.id })).status).toBe(400);
    expect((await slot(s.admin, s.otherClass.id, { day: 1, periodId: upper.body.periods[1].id, subjectId: maths.id })).status).toBe(200);
    // Moving a class with lessons to another school day asks first.
    expect((await as(s.admin).put(`/api/timetable/classes/${s.otherClass.id}/schedule`).send({ scheduleId: null })).status).toBe(409);
    expect((await as(s.admin).delete(`/api/timetable/schedules/${sched.id}`)).status).toBe(400); // the default
  });

  it("refuses a lesson on a day its period doesn't run", async () => {
    const onlyTue = periods.map((p) => (p.label === "4" ? { ...p, days: [2] } : p));
    await as(s.admin).put(`/api/timetable/schedules/${sched.id}`).send({ name: "School day", periods: onlyTue });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("4"), subjectId: maths.id })).body.message).toMatch(/doesn't run on Monday/);
    expect((await slot(s.admin, s.klass.id, { day: 2, periodId: P("4"), subjectId: maths.id })).status).toBe(200);
  });
});

describe("placing lessons", () => {
  it("picks the assigned teacher and the subject's room; refuses breaks, unassigned subjects and other teachers", async () => {
    const lab = (await as(s.admin).post("/api/timetable/rooms").send({ name: "Lab" })).body;
    await as(s.admin).put(`/api/timetable/classes/${s.klass.id}/targets`).send({ items: [{ assignmentId: aMaths.id, roomId: lab.id }] });
    const r = await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    expect(r.body.lesson).toMatchObject({ teacherId: s.teacher.teacherId, room: "Lab", year: 2026 });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("Break"), subjectId: maths.id })).status).toBe(400);
    const sci = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Science" } });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: sci.id })).body.message).toMatch(/No teacher is assigned/);
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: maths.id, teacherId: s.teacher2.teacherId })).status).toBe(400);
  });

  it("refuses a teacher or a room in two places at once, naming the clash", async () => {
    const lab = (await as(s.admin).post("/api/timetable/rooms").send({ name: "Lab" })).body;
    expect((await as(s.admin).post("/api/timetable/rooms").send({ name: "Lab" })).status).toBe(409);
    await slot(s.admin, s.otherClass.id, { day: 2, periodId: P("1"), subjectId: maths.id, roomId: lab.id });
    const t = await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: eng.id });
    expect(t.body).toMatchObject({ code: "TEACHER_CLASH", message: expect.stringMatching(/Grade 8 E/) });
    expect((await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: kis.id, roomId: lab.id })).body.code).toBe("ROOM_CLASH");
    expect((await slot(s.admin, s.klass.id, { day: 2, periodId: P("1"), subjectId: kis.id })).status).toBe(200);
  });

  it("replaces and clears a slot; keeps years and schools apart", async () => {
    await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: maths.id });
    expect((await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: kis.id })).body.lesson.subjectId).toBe(kis.id);
    expect((await slot(s.admin, s.klass.id, { day: 3, periodId: P("2"), subjectId: null })).body).toEqual({ cleared: true });
    const old = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 6", stream: "E", year: 2025 } });
    await prisma.lesson.create({ data: { schoolId: s.school.id, classId: old.id, year: 2025, day: 1, periodId: P("1"), subjectId: maths.id, teacherId: s.teacher.teacherId } });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(200);
    const other = await makeSchool();
    expect((await slot(s.admin, other.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(404);
  });

  it("lets a class split into parallel groups, but not a group beside a whole-class lesson", async () => {
    await assign(s.teacher.teacherId, s.klass.id, cre.id);
    await assign(s.teacher2.teacherId, s.klass.id, ire.id);
    expect((await slot(s.admin, s.klass.id, { day: 4, periodId: P("1"), subjectId: cre.id, group: "CRE" })).status).toBe(200);
    expect((await slot(s.admin, s.klass.id, { day: 4, periodId: P("1"), subjectId: ire.id, group: "IRE" })).status).toBe(200);
    expect((await slot(s.admin, s.klass.id, { day: 4, periodId: P("1"), subjectId: kis.id })).body.code).toBe("CLASS_CLASH");
    const t = await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`);
    expect(t.body.lessons.filter((l) => l.day === 4).map((l) => l.group).sort()).toEqual(["CRE", "IRE"]);
  });

  it("teaches several classes at once as one combined lesson", async () => {
    const r = await slot(s.admin, s.klass.id, { day: 5, periodId: P("1"), subjectId: maths.id, alsoClassIds: [s.otherClass.id] });
    expect(r.status).toBe(200);
    expect(r.body.combinedWith).toEqual(["Grade 8 E"]);
    const mine = await as(s.teacher).get("/api/timetable/me");
    expect(mine.body.lessons.filter((l) => l.day === 5)).toHaveLength(1);
    expect(mine.body.lessons.find((l) => l.day === 5).class.label).toBe("Grade 7 E + Grade 8 E");
    // A class whose subject has another teacher can't join.
    const g9 = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 9", year: 2026 } });
    await assign(s.teacher2.teacherId, g9.id, maths.id);
    expect((await slot(s.admin, s.klass.id, { day: 5, periodId: P("2"), subjectId: maths.id, alsoClassIds: [g9.id] })).status).toBe(400);
  });

  it("has two simultaneous saves for the same teacher end with exactly one lesson", async () => {
    const results = await Promise.all([
      slot(s.admin, s.klass.id, { day: 3, periodId: P("4"), subjectId: maths.id }),
      slot(s.admin, s.otherClass.id, { day: 3, periodId: P("4"), subjectId: maths.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.lesson.count({ where: { teacherId: s.teacher.teacherId, day: 3, periodId: P("4") } })).toBe(1);
  });
});

describe("teacher rules", () => {
  it("unavailable times and a daily maximum stop lessons, and can't be set over existing ones", async () => {
    const rules = (body) => as(s.admin).put(`/api/timetable/teachers/${s.teacher.teacherId}/rules`).send(body);
    expect((await rules({ maxLessonsPerDay: 1, blocks: [{ day: 2, startsAt: "08:00", endsAt: "09:20", note: "Part-time" }] })).status).toBe(200);
    expect((await slot(s.admin, s.klass.id, { day: 2, periodId: P("2"), subjectId: maths.id })).body).toMatchObject({ code: "TEACHER_UNAVAILABLE", message: expect.stringMatching(/Part-time/) });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(200);
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: eng.id })).body.code).toBe("TEACHER_MAX");
    // A combined lesson counts once.
    await rules({ maxLessonsPerDay: 2, blocks: [] });
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("3"), subjectId: maths.id, alsoClassIds: [s.otherClass.id] })).status).toBe(200);
    // Can't block a time that already has a lesson, or cap below today's count.
    expect((await rules({ maxLessonsPerDay: 1, blocks: [] })).status).toBe(409);
    expect((await rules({ blocks: [{ day: 1, startsAt: "08:00", endsAt: "08:30" }] })).status).toBe(409);
    expect((await as(s.teacher).put(`/api/timetable/teachers/${s.teacher.teacherId}/rules`).send({})).status).toBe(403);
  });
});

describe("moving lessons", () => {
  it("moves to an empty slot, swaps with a full one, and refuses a move that clashes", async () => {
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: kis.id });
    const move = (from, to) => as(s.admin).put(`/api/timetable/classes/${s.klass.id}/move`).send({ from, to });
    expect((await move({ day: 1, periodId: P("1") }, { day: 2, periodId: P("1") })).body).toEqual({ moved: true, swapped: false });
    expect((await move({ day: 2, periodId: P("1") }, { day: 1, periodId: P("2") })).body).toEqual({ moved: true, swapped: true });
    const t = (await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`)).body.lessons;
    expect(t.find((l) => l.day === 1 && l.periodId === P("2")).subjectId).toBe(maths.id);
    expect(t.find((l) => l.day === 2 && l.periodId === P("1")).subjectId).toBe(kis.id);
    // Maths teacher busy in Grade 8 on Wednesday 1: moving there clashes.
    await slot(s.admin, s.otherClass.id, { day: 3, periodId: P("1"), subjectId: maths.id });
    expect((await move({ day: 1, periodId: P("2") }, { day: 3, periodId: P("1") })).body.code).toBe("TEACHER_CLASH");
  });
});

describe("targets and auto-fill", () => {
  it("fills with doubles back to back, rooms booked once, option blocks side by side and no clashes", async () => {
    const lab = (await as(s.admin).post("/api/timetable/rooms").send({ name: "Lab" })).body;
    const aCre = await assign(s.teacher.teacherId, s.klass.id, cre.id);
    const aIre = await assign(s.teacher2.teacherId, s.klass.id, ire.id);
    const targets = (classId, items) => as(s.admin).put(`/api/timetable/classes/${classId}/targets`).send({ items });
    expect((await targets(s.klass.id, [{ assignmentId: aMaths.id, lessonsPerWeek: 4, doublesPerWeek: 1, roomId: lab.id }, { assignmentId: aEng.id, lessonsPerWeek: 3 }, { assignmentId: aKis.id, lessonsPerWeek: 3 }, { assignmentId: aCre.id, lessonsPerWeek: 2, optionBlock: "Religion" }, { assignmentId: aIre.id, lessonsPerWeek: 2, optionBlock: "Religion" }])).status).toBe(200);
    expect((await targets(s.otherClass.id, [{ assignmentId: aMathsOther.id, lessonsPerWeek: 4, roomId: lab.id }])).status).toBe(200);
    expect((await targets(s.klass.id, [{ assignmentId: aEng.id, lessonsPerWeek: 2, doublesPerWeek: 2 }])).status).toBe(400);

    const preview = await as(s.admin).get("/api/timetable/autofill?year=2026");
    expect(preview.body).toMatchObject({ applied: false, unplaced: 0 });
    expect(await prisma.lesson.count({ where: { schoolId: s.school.id } })).toBe(0);
    expect((await as(s.admin).post("/api/timetable/autofill").send({ year: 2026 })).status).toBe(200);

    const all = await prisma.lesson.findMany({ where: { schoolId: s.school.id }, include: { period: true } });
    expect(all).toHaveLength(4 + 3 + 3 + 2 + 2 + 4);
    const keyOf = (l) => `${l.day}|${l.period.startsAt}`;
    const t1 = all.filter((l) => l.teacherId === s.teacher.teacherId).map(keyOf);
    expect(new Set(t1).size).toBe(t1.length);
    const labUse = all.filter((l) => l.roomId === lab.id).map(keyOf);
    expect(new Set(labUse).size).toBe(labUse.length);
    // Religion: CRE and IRE always together, as groups.
    const rel = all.filter((l) => l.subjectId === cre.id || l.subjectId === ire.id);
    expect(rel.every((l) => l.group)).toBe(true);
    const relSlots = new Map();
    for (const l of rel) relSlots.set(keyOf(l), (relSlots.get(keyOf(l)) || 0) + 1);
    expect([...relSlots.values()].every((n) => n === 2)).toBe(true);
    // One double: two maths lessons back to back on one day.
    const mathDays = new Map();
    for (const l of all.filter((x) => x.classId === s.klass.id && x.subjectId === maths.id)) mathDays.set(l.day, [...(mathDays.get(l.day) || []), l.period.position]);
    const doubleDay = [...mathDays.values()].find((v) => v.length === 2);
    expect(doubleDay).toBeTruthy();
    expect(Math.abs(doubleDay[0] - doubleDay[1])).toBe(1);
    expect((await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`)).body.warnings).toEqual([]);
    expect((await as(s.admin).get("/api/timetable/autofill?year=2026")).body.placed).toBe(0);
  });

  it("is for admins only", async () => {
    expect((await as(s.teacher).get("/api/timetable/autofill?year=2026")).status).toBe(403);
  });
});

describe("copy forward", () => {
  it("starts next year's timetable from this year's, matching classes by name", async () => {
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("2"), subjectId: kis.id });
    const next = await prisma.class.create({ data: { schoolId: s.school.id, name: "Grade 7", stream: "E", year: 2027 } });
    await assign(s.teacher.teacherId, next.id, maths.id); // Kiswahili not assigned next year
    const r = await as(s.admin).post("/api/timetable/copy").send({ fromYear: 2026, toYear: 2027 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ copied: 1, skipped: 1 });
    expect(r.body.details[0]).toMatch(/not assigned/);
    expect(await prisma.lesson.count({ where: { classId: next.id, year: 2027 } })).toBe(1);
  });
});

describe("who sees what", () => {
  beforeEach(async () => {
    await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id });
    await slot(s.admin, s.otherClass.id, { day: 1, periodId: P("2"), subjectId: maths.id });
  });

  it("teachers see classes and their own week, not a colleague's or their rules", async () => {
    const mine = await as(s.teacher).get("/api/timetable/me");
    expect(mine.body.lessons.map((l) => l.class.label).sort()).toEqual(["Grade 7 E", "Grade 8 E"]);
    expect((await as(s.teacher).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(200);
    expect((await as(s.teacher).get(`/api/timetable/teachers/${s.teacher2.teacherId}`)).status).toBe(403);
    expect((await as(s.teacher).get(`/api/timetable/teachers/${s.teacher.teacherId}/rules`)).status).toBe(403);
  });

  it("a learner or parent sees only their own class's week, without planning details", async () => {
    const own = await as(s.studentUser).get(`/api/timetable/classes/${s.klass.id}`);
    expect(own.status).toBe(200);
    expect(own.body.load).toBeUndefined();
    expect((await as(s.studentUser).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(403);
    expect((await as(s.bursar).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(403);
    const user = await prisma.user.create({ data: { email: `+2547${String(Date.now()).slice(-8)}`, password: "x", role: "PARENT", schoolId: s.school.id, isActive: true, mustChangePassword: false } });
    const mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: user.email, userId: user.id } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[1].id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
    const me = await as(user).get("/api/timetable/me");
    expect(me.body.learners.map((l) => l.learner.name)).toEqual(["Student2 Test"]);
    expect((await as(user).get(`/api/timetable/classes/${s.otherClass.id}`)).status).toBe(403);
  });

  it("today lists the caller's lessons for today's weekday", async () => {
    const r = await as(s.teacher).get("/api/timetable/today");
    expect(r.body.now).toMatch(/^\d\d:\d\d$/);
    expect(r.body.lessons).toHaveLength(r.body.day === 1 ? 2 : 0);
  });

  it("prints a class or a teacher on one landscape page", async () => {
    const c = await as(s.studentUser).get(`/api/timetable/classes/${s.klass.id}/pdf`).buffer(true).parse(binary);
    expect(c.status).toBe(200);
    expect(pages(c.body)).toBe(1);
    const t = await as(s.teacher).get(`/api/timetable/teachers/${s.teacher.teacherId}/pdf`).buffer(true).parse(binary);
    expect(pages(t.body)).toBe(1);
  });
});

describe("lapsed plan", () => {
  it("keeps the timetable readable but refuses changes", async () => {
    await prisma.subscription.updateMany({ where: { schoolId: s.school.id }, data: { currentPeriodEnd: new Date(Date.now() - 86400000) } });
    expect((await as(s.admin).get(`/api/timetable/classes/${s.klass.id}`)).status).toBe(200);
    expect((await slot(s.admin, s.klass.id, { day: 1, periodId: P("1"), subjectId: maths.id })).status).toBe(402);
    expect((await as(s.admin).post("/api/timetable/rooms").send({ name: "Lab" })).status).toBe(402);
  });
});
