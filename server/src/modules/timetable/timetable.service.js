// src/modules/timetable/timetable.service.js
// Reading and changing the timetable. Every function is scoped to one school
// (schoolId); clash rules live in the database's unique keys (see Lesson in
// schema.prisma) and are also checked here first for a clear message.
import { prisma } from "../../lib/prisma.js";
import { getSchoolCalendar, localDateString } from "../../utils/schoolTime.js";
import { DAY_NAMES, MAX_LESSONS_PER_WEEK, normaliseRoom, planLessons, readSetup, slotKey } from "./timetable.rules.js";

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const classLabel = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""}` : "a class");
const teacherName = (t) => (t ? `${t.firstName} ${t.lastName}`.trim() : null);

const lessonInclude = {
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  class: { select: { id: true, name: true, stream: true, year: true } },
};
const shapeLesson = (l) => ({
  id: l.id,
  classId: l.classId,
  year: l.year,
  day: l.day,
  periodId: l.periodId,
  subjectId: l.subjectId,
  subject: l.subject ? { id: l.subject.id, name: l.subject.name, code: l.subject.code } : null,
  teacherId: l.teacherId,
  teacher: l.teacher ? { id: l.teacher.id, name: teacherName(l.teacher) } : null,
  class: l.class ? { id: l.class.id, label: classLabel(l.class), year: l.class.year } : null,
  room: l.room,
});

/* ------------------------------------------------------------------ */
/* Bell times                                                          */
/* ------------------------------------------------------------------ */

export async function getSetup(schoolId) {
  const [settings, periods, subjects] = await Promise.all([
    prisma.schoolSettings.findUnique({ where: { schoolId }, select: { timetableDays: true } }),
    prisma.timetablePeriod.findMany({ where: { schoolId }, orderBy: { position: "asc" } }),
    // Names only, for a colour per subject that's the same in every class.
    prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const days = settings?.timetableDays?.length ? settings.timetableDays : [1, 2, 3, 4, 5];
  return {
    days,
    subjects,
    periods: periods.map((p) => ({ id: p.id, position: p.position, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, kind: p.kind })),
  };
}

/**
 * Replaces the school day. Keeps existing periods (by id) so their lessons
 * stay put. Refuses, with what would be lost, to drop a period or a day
 * that has lessons, or to turn a lesson period into a break, unless
 * removeLessons is true.
 */
export async function saveSetup(schoolId, input, { removeLessons = false } = {}) {
  const r = readSetup(input);
  if (r.error) throw httpError(400, r.error);
  const { days, periods } = r;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.timetablePeriod.findMany({ where: { schoolId } });
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const p of periods) if (p.id && !byId.has(p.id)) throw httpError(400, "One of the periods doesn't belong to this school.");

    const keptIds = new Set(periods.filter((p) => p.id).map((p) => p.id));
    const dropped = existing.filter((p) => !keptIds.has(p.id)).map((p) => p.id);
    const toBreak = periods.filter((p) => p.id && p.kind === "BREAK" && byId.get(p.id).kind === "LESSON").map((p) => p.id);
    const lostWhere = {
      schoolId,
      OR: [
        ...(dropped.length || toBreak.length ? [{ periodId: { in: [...dropped, ...toBreak] } }] : []),
        { day: { notIn: days } },
      ],
    };
    const lost = await tx.lesson.count({ where: lostWhere });
    if (lost && !removeLessons) {
      throw httpError(409, `This removes ${lost} lesson${lost === 1 ? "" : "s"} already on the timetable (in a period or day you took out, or a period you made a break). Save again to confirm.`, {
        code: "TIMETABLE_HAS_LESSONS",
        lessons: lost,
      });
    }
    if (lost) await tx.lesson.deleteMany({ where: lostWhere });
    if (dropped.length) await tx.timetablePeriod.deleteMany({ where: { schoolId, id: { in: dropped } } });

    // Positions are unique: move the kept ones out of the way first.
    const kept = periods.filter((p) => p.id);
    for (const p of kept) await tx.timetablePeriod.update({ where: { id: p.id }, data: { position: 1000 + p.position } });
    for (const p of periods) {
      const data = { position: p.position, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, kind: p.kind };
      if (p.id) await tx.timetablePeriod.update({ where: { id: p.id }, data });
      else await tx.timetablePeriod.create({ data: { schoolId, ...data } });
    }
    await tx.schoolSettings.upsert({ where: { schoolId }, create: { schoolId, timetableDays: days }, update: { timetableDays: days } });

    const saved = await tx.timetablePeriod.findMany({ where: { schoolId }, orderBy: { position: "asc" } });
    return {
      days,
      periods: saved.map((p) => ({ id: p.id, position: p.position, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, kind: p.kind })),
      removedLessons: lost,
    };
  });
}

/* ------------------------------------------------------------------ */
/* A class's timetable                                                 */
/* ------------------------------------------------------------------ */

async function findClass(schoolId, classId) {
  const klass = await prisma.class.findFirst({ where: { id: String(classId), schoolId }, select: { id: true, name: true, stream: true, year: true, isActive: true } });
  if (!klass) throw httpError(404, "Class not found.");
  return klass;
}

/** The class's week, who teaches what (with weekly targets), and anything that needs attention. */
export async function getClassTimetable(schoolId, classId) {
  const klass = await findClass(schoolId, classId);
  const [setup, lessons, assignments] = await Promise.all([
    getSetup(schoolId),
    prisma.lesson.findMany({ where: { schoolId, classId: klass.id }, include: lessonInclude }),
    prisma.teachingAssignment.findMany({
      where: { schoolId, classId: klass.id, isActive: true, subject: { isActive: true } },
      include: { subject: { select: { id: true, name: true } }, teacher: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  const periodById = new Map(setup.periods.map((p) => [p.id, p]));

  const load = assignments
    .map((a) => {
      const placed = lessons.filter((l) => l.subjectId === a.subjectId && l.teacherId === a.teacherId).length;
      return {
        assignmentId: a.id,
        subjectId: a.subjectId,
        subject: a.subject.name,
        teacherId: a.teacherId,
        teacher: teacherName(a.teacher),
        lessonsPerWeek: a.lessonsPerWeek,
        placed,
      };
    })
    .sort((x, y) => x.subject.localeCompare(y.subject) || String(x.teacher).localeCompare(String(y.teacher)));

  const warnings = [];
  const assigned = new Set(assignments.map((a) => `${a.subjectId}|${a.teacherId}`));
  for (const l of lessons) {
    const when = `${DAY_NAMES[l.day]} ${periodById.get(l.periodId)?.label ?? ""}`.trim();
    if (!l.teacherId) warnings.push({ kind: "NO_TEACHER", message: `${l.subject?.name} on ${when} has no teacher.` });
    else if (!assigned.has(`${l.subjectId}|${l.teacherId}`))
      warnings.push({ kind: "NOT_ASSIGNED", message: `${l.subject?.name} on ${when}: ${teacherName(l.teacher)} is no longer assigned to teach it here.` });
  }
  for (const a of load) {
    if (a.lessonsPerWeek == null) continue;
    if (a.placed < a.lessonsPerWeek) warnings.push({ kind: "SHORT", message: `${a.subject}: ${a.placed} of ${a.lessonsPerWeek} lessons placed.` });
    if (a.placed > a.lessonsPerWeek) warnings.push({ kind: "OVER", message: `${a.subject}: ${a.placed} lessons placed, target ${a.lessonsPerWeek}.` });
  }
  const perDay = new Map();
  for (const l of lessons) perDay.set(`${l.subjectId}|${l.day}`, (perDay.get(`${l.subjectId}|${l.day}`) || 0) + 1);
  for (const [k, n] of perDay) {
    if (n < 3) continue;
    const [subjectId, day] = k.split("|");
    const name = lessons.find((l) => l.subjectId === subjectId)?.subject?.name;
    warnings.push({ kind: "HEAVY_DAY", message: `${name} ${n} times on ${DAY_NAMES[day]}.` });
  }

  return {
    class: { id: klass.id, label: classLabel(klass), year: klass.year, isActive: klass.isActive },
    ...setup,
    lessons: lessons.map(shapeLesson),
    load,
    warnings,
  };
}

/**
 * Puts a subject in one slot of a class's week (replacing what was there), or
 * clears it (subjectId null). The teacher must be one assigned to teach that
 * subject in that class; with exactly one, it's chosen for you.
 */
export async function setSlot(schoolId, classId, body) {
  const klass = await findClass(schoolId, classId);
  if (!klass.isActive) throw httpError(400, "This class is no longer active.");
  const day = Number(body?.day);
  const setup = await getSetup(schoolId);
  if (!setup.days.includes(day)) throw httpError(400, "That day isn't one of the school's timetable days.");
  const period = setup.periods.find((p) => p.id === String(body?.periodId || ""));
  if (!period) throw httpError(400, "Choose a period from the school day.");
  if (period.kind !== "LESSON") throw httpError(400, `${period.label} is a break; lessons can't go there.`);

  const where = { classId_day_periodId: { classId: klass.id, day, periodId: period.id } };

  if (body?.subjectId == null || body.subjectId === "") {
    await prisma.lesson.deleteMany({ where: { schoolId, classId: klass.id, day, periodId: period.id } });
    return { cleared: true };
  }

  const subject = await prisma.subject.findFirst({ where: { id: String(body.subjectId), schoolId, isActive: true }, select: { id: true, name: true } });
  if (!subject) throw httpError(400, "Subject not found.");
  const assignments = await prisma.teachingAssignment.findMany({
    where: { schoolId, classId: klass.id, subjectId: subject.id, isActive: true },
    select: { teacherId: true },
  });
  if (!assignments.length) {
    throw httpError(400, `No teacher is assigned to teach ${subject.name} in ${classLabel(klass)}. Assign one in Settings > Curriculum first.`);
  }
  let teacherId = body.teacherId ? String(body.teacherId) : null;
  if (!teacherId) {
    if (assignments.length > 1) throw httpError(400, `More than one teacher teaches ${subject.name} in ${classLabel(klass)}; choose which.`);
    teacherId = assignments[0].teacherId;
  } else if (!assignments.some((a) => a.teacherId === teacherId)) {
    throw httpError(400, `That teacher isn't assigned to teach ${subject.name} in ${classLabel(klass)}.`);
  }
  const room = normaliseRoom(body.room);

  // Friendly clash messages first; the unique keys catch any race after this.
  const others = await prisma.lesson.findMany({
    where: {
      schoolId,
      year: klass.year,
      day,
      periodId: period.id,
      classId: { not: klass.id },
      OR: [{ teacherId }, ...(room ? [{ room }] : [])],
    },
    include: lessonInclude,
  });
  const when = `${DAY_NAMES[day]}, ${period.label} (${period.startsAt}-${period.endsAt})`;
  const teacherClash = others.find((l) => l.teacherId === teacherId);
  if (teacherClash) {
    throw httpError(409, `${teacherName(teacherClash.teacher)} already teaches ${classLabel(teacherClash.class)} (${teacherClash.subject?.name}) on ${when}.`, {
      code: "TEACHER_CLASH",
    });
  }
  const roomClash = room && others.find((l) => l.room === room);
  if (roomClash) throw httpError(409, `${room} is already used by ${classLabel(roomClash.class)} on ${when}.`, { code: "ROOM_CLASH" });

  try {
    const lesson = await prisma.lesson.upsert({
      where,
      create: { schoolId, classId: klass.id, year: klass.year, day, periodId: period.id, subjectId: subject.id, teacherId, room },
      update: { subjectId: subject.id, teacherId, room, year: klass.year },
      include: lessonInclude,
    });
    return { lesson: shapeLesson(lesson) };
  } catch (e) {
    if (e?.code === "P2002") throw httpError(409, "Someone just filled that slot or booked that teacher or room. Reload and try again.", { code: "CLASH" });
    throw e;
  }
}

/** Sets lessons-per-week targets: items [{ assignmentId, lessonsPerWeek|null }] for this class. */
export async function setTargets(schoolId, classId, items) {
  const klass = await findClass(schoolId, classId);
  if (!Array.isArray(items) || !items.length) throw httpError(400, "Send the targets to change.");
  const ids = items.map((i) => String(i?.assignmentId || ""));
  const found = await prisma.teachingAssignment.findMany({ where: { schoolId, classId: klass.id, id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw httpError(400, "One of those subjects isn't taught in this class.");
  for (const i of items) {
    const v = i.lessonsPerWeek;
    if (v != null && v !== "" && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > MAX_LESSONS_PER_WEEK)) {
      throw httpError(400, `Lessons a week must be a whole number from 0 to ${MAX_LESSONS_PER_WEEK}.`);
    }
  }
  await prisma.$transaction(
    items.map((i) =>
      prisma.teachingAssignment.update({
        where: { id: String(i.assignmentId) },
        data: { lessonsPerWeek: i.lessonsPerWeek == null || i.lessonsPerWeek === "" ? null : Number(i.lessonsPerWeek) },
      })
    )
  );
  return getClassTimetable(schoolId, klass.id);
}

/* ------------------------------------------------------------------ */
/* Auto-fill                                                           */
/* ------------------------------------------------------------------ */

/**
 * Plans the remaining lessons of the given classes (all active classes of
 * `year` when classIds is empty). Classes are planned one after another,
 * sharing teacher availability, so the plan never clashes. With apply, the
 * plan is written in one transaction; a lesson placed by someone else in the
 * meantime makes the whole apply fail (preview again).
 */
export async function autofill(schoolId, { classIds = [], year, apply = false } = {}) {
  const setup = await getSetup(schoolId);
  const lessonPeriods = setup.periods.filter((p) => p.kind === "LESSON");
  if (!lessonPeriods.length) throw httpError(400, "Set the school day's periods first (Timetable > Bell times).");

  const classes = classIds.length
    ? await prisma.class.findMany({ where: { schoolId, id: { in: classIds.map(String) }, isActive: true }, orderBy: [{ name: "asc" }, { stream: "asc" }] })
    : await prisma.class.findMany({ where: { schoolId, isActive: true, ...(year ? { year: Number(year) } : {}) }, orderBy: [{ name: "asc" }, { stream: "asc" }] });
  if (!classes.length) throw httpError(404, "No active class to fill.");
  const years = [...new Set(classes.map((c) => c.year))];
  if (years.length > 1) throw httpError(400, "Fill one academic year at a time.");
  const theYear = years[0];

  const yearLessons = await prisma.lesson.findMany({ where: { schoolId, year: theYear }, select: { classId: true, day: true, periodId: true, subjectId: true, teacherId: true } });
  const inDay = (l) => setup.days.includes(l.day);
  const teacherBusy = new Map();
  const teacherDayLoad = new Map();
  for (const l of yearLessons.filter(inDay)) {
    if (!l.teacherId) continue;
    if (!teacherBusy.has(l.teacherId)) teacherBusy.set(l.teacherId, new Set());
    teacherBusy.get(l.teacherId).add(slotKey(l.day, l.periodId));
    if (!teacherDayLoad.has(l.teacherId)) teacherDayLoad.set(l.teacherId, new Map());
    const m = teacherDayLoad.get(l.teacherId);
    m.set(l.day, (m.get(l.day) || 0) + 1);
  }

  const assignments = await prisma.teachingAssignment.findMany({
    where: { schoolId, classId: { in: classes.map((c) => c.id) }, isActive: true, subject: { isActive: true } },
    include: { subject: { select: { name: true } }, teacher: { select: { firstName: true, lastName: true } } },
  });

  const results = [];
  for (const c of classes) {
    const mine = yearLessons.filter((l) => l.classId === c.id && inDay(l));
    const classBusy = new Set(mine.map((l) => slotKey(l.day, l.periodId)));
    const subjectDays = new Map();
    for (const l of mine) {
      if (!subjectDays.has(l.subjectId)) subjectDays.set(l.subjectId, new Map());
      const m = subjectDays.get(l.subjectId);
      m.set(l.day, (m.get(l.day) || 0) + 1);
    }
    const own = assignments.filter((a) => a.classId === c.id && a.lessonsPerWeek > 0);
    const needs = own.map((a) => ({
      subjectId: a.subjectId,
      teacherId: a.teacherId,
      count: Math.max(0, a.lessonsPerWeek - mine.filter((l) => l.subjectId === a.subjectId && l.teacherId === a.teacherId).length),
    }));
    const { placed, unplaced } = planLessons({ days: setup.days, periods: lessonPeriods, needs, classBusy, teacherBusy, subjectDays, teacherDayLoad });
    const name = (subjectId, teacherId) => {
      const a = own.find((x) => x.subjectId === subjectId && x.teacherId === teacherId);
      return { subject: a?.subject?.name, teacher: teacherName(a?.teacher) };
    };
    results.push({
      class: { id: c.id, label: classLabel(c), year: c.year },
      withoutTargets: assignments.filter((a) => a.classId === c.id && a.lessonsPerWeek == null).length,
      placed: placed.map((p) => ({ ...p, ...name(p.subjectId, p.teacherId) })),
      unplaced: unplaced.map((u) => ({ ...u, ...name(u.subjectId, u.teacherId) })),
    });
  }

  if (apply) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const r of results) {
          for (const p of r.placed) {
            await tx.lesson.create({
              data: { schoolId, classId: r.class.id, year: theYear, day: p.day, periodId: p.periodId, subjectId: p.subjectId, teacherId: p.teacherId },
            });
          }
        }
      });
    } catch (e) {
      if (e?.code === "P2002") throw httpError(409, "The timetable changed while you were looking. Preview again, then apply.", { code: "CLASH" });
      throw e;
    }
  }
  return {
    year: theYear,
    applied: apply,
    placed: results.reduce((n, r) => n + r.placed.length, 0),
    unplaced: results.reduce((n, r) => n + r.unplaced.reduce((m, u) => m + u.missing, 0), 0),
    classes: results,
  };
}

/* ------------------------------------------------------------------ */
/* A teacher's week, "my" timetable, today                             */
/* ------------------------------------------------------------------ */

export async function getTeacherTimetable(schoolId, teacherId, { year } = {}) {
  const teacher = await prisma.teacher.findFirst({ where: { id: String(teacherId), schoolId }, select: { id: true, firstName: true, lastName: true } });
  if (!teacher) throw httpError(404, "Teacher not found.");
  const theYear = year ? Number(year) : await currentTimetableYear(schoolId);
  const [setup, lessons] = await Promise.all([
    getSetup(schoolId),
    prisma.lesson.findMany({ where: { schoolId, teacherId: teacher.id, year: theYear }, include: lessonInclude }),
  ]);
  const perDay = Object.fromEntries(setup.days.map((d) => [d, lessons.filter((l) => l.day === d).length]));
  return { teacher: { id: teacher.id, name: teacherName(teacher) }, year: theYear, ...setup, lessons: lessons.map(shapeLesson), totals: { week: lessons.length, perDay } };
}

/** The school's current academic year (settings), else this calendar year. */
export async function currentTimetableYear(schoolId) {
  const cal = await getSchoolCalendar(schoolId);
  return Number(cal.currentYear) || Number(localDateString(new Date(), cal.timezone).slice(0, 4));
}

/** Learners a student or parent sees, each with their class. */
async function learnersOf(schoolId, studentIds) {
  if (!studentIds.length) return [];
  return prisma.student.findMany({
    where: { schoolId, id: { in: studentIds }, isActive: true },
    select: { id: true, firstName: true, lastName: true, classId: true },
    orderBy: { firstName: "asc" },
  });
}

/**
 * The caller's own timetable: a teacher's week, or for a learner/parent each
 * learner's class week.
 */
export async function getMine(schoolId, { role, teacherId, studentIds = [] }) {
  if (role === "TEACHER") {
    if (!teacherId) throw httpError(404, "Your account isn't linked to a teacher record.");
    return { kind: "teacher", ...(await getTeacherTimetable(schoolId, teacherId)) };
  }
  const learners = await learnersOf(schoolId, studentIds);
  const out = [];
  for (const st of learners) {
    out.push({
      learner: { id: st.id, name: `${st.firstName} ${st.lastName}`.trim() },
      timetable: st.classId ? await getClassTimetable(schoolId, st.classId).then(({ load, warnings, ...t }) => t) : null, // eslint-disable-line no-unused-vars
    });
  }
  return { kind: "learners", learners: out };
}

/** Today's lessons for the caller, with the time now in the school, for "next lesson". */
export async function getToday(schoolId, who) {
  const cal = await getSchoolCalendar(schoolId);
  const now = new Date();
  const today = localDateString(now, cal.timezone);
  const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: cal.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const setup = await getSetup(schoolId);
  const base = { date: today, day: weekday, dayName: DAY_NAMES[weekday] || "Sunday", now: time, schoolDay: setup.days.includes(weekday), periods: setup.periods };

  if (who.role === "TEACHER" || who.role === "ADMIN") {
    if (!who.teacherId) return { ...base, lessons: [] };
    const year = await currentTimetableYear(schoolId);
    const lessons = await prisma.lesson.findMany({ where: { schoolId, teacherId: who.teacherId, year, day: weekday }, include: lessonInclude });
    return { ...base, lessons: lessons.map(shapeLesson) };
  }
  const learners = await learnersOf(schoolId, who.studentIds || []);
  const classIds = [...new Set(learners.map((l) => l.classId).filter(Boolean))];
  const lessons = classIds.length ? await prisma.lesson.findMany({ where: { schoolId, classId: { in: classIds }, day: weekday }, include: lessonInclude }) : [];
  return {
    ...base,
    learners: learners.map((st) => ({
      id: st.id,
      name: `${st.firstName} ${st.lastName}`.trim(),
      lessons: lessons.filter((l) => l.classId === st.classId).map(shapeLesson),
    })),
  };
}
