// src/modules/timetable/timetable.service.js
// Reading and changing the timetable, one school at a time. Every change runs
// in a transaction that first takes a per-school lock, then checks clashes by
// time (classes can keep different bell schedules): the class (or the same
// group of it), the teacher, the room, the teacher's unavailable times and
// daily maximum. Combined lessons (same linkId) share a teacher and room on
// purpose. Because writes for a school queue behind the lock, two people
// saving at once can't create a clash between the check and the write.
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { getSchoolCalendar, localDateString } from "../../utils/schoolTime.js";
import { DAY_NAMES, MAX_LESSONS_PER_WEEK, lessonSlots, overlaps, planLessons, readDays, readSchedule, runsOn, timeToMinutes } from "./timetable.rules.js";

export const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const classLabel = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""}` : "a class");
const teacherName = (t) => (t ? `${t.firstName} ${t.lastName}`.trim() : null);
const TX = { timeout: 30000, maxWait: 15000 };

/** Serialises timetable writes for one school (released at the end of the transaction). */
async function lock(tx, schoolId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`timetable:${schoolId}`}))::text`;
}
const write = (schoolId, fn) =>
  prisma.$transaction(async (tx) => {
    await lock(tx, schoolId);
    return fn(tx);
  }, TX);

const lessonInclude = {
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  class: { select: { id: true, name: true, stream: true, year: true } },
  room: { select: { id: true, name: true } },
  period: { select: { id: true, startsAt: true, endsAt: true, label: true } },
};
const shapeLesson = (l) => ({
  id: l.id,
  classId: l.classId,
  year: l.year,
  day: l.day,
  periodId: l.periodId,
  startsAt: l.period?.startsAt,
  endsAt: l.period?.endsAt,
  subjectId: l.subjectId,
  subject: l.subject ? { id: l.subject.id, name: l.subject.name, code: l.subject.code } : null,
  teacherId: l.teacherId,
  teacher: l.teacher ? { id: l.teacher.id, name: teacherName(l.teacher) } : null,
  class: l.class ? { id: l.class.id, label: classLabel(l.class), year: l.class.year } : null,
  roomId: l.roomId,
  room: l.room?.name || null,
  group: l.group || "",
  linkId: l.linkId,
});
const shapePeriod = (p) => ({ id: p.id, position: p.position, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, kind: p.kind, days: p.days || [] });

/* ------------------------------------------------------------------ */
/* School days, bell schedules                                         */
/* ------------------------------------------------------------------ */

export async function getDays(db, schoolId) {
  const s = await db.schoolSettings.findUnique({ where: { schoolId }, select: { timetableDays: true } });
  return s?.timetableDays?.length ? s.timetableDays : [1, 2, 3, 4, 5];
}

/** The default schedule, made (empty) if the school has none yet. */
async function defaultSchedule(db, schoolId) {
  const found = (await db.timetableSchedule.findFirst({ where: { schoolId, isDefault: true } })) || (await db.timetableSchedule.findFirst({ where: { schoolId }, orderBy: { createdAt: "asc" } }));
  if (found) return found;
  return db.timetableSchedule.create({ data: { schoolId, name: "School day", isDefault: true } });
}

async function scheduleOf(db, schoolId, klass) {
  if (klass?.timetableScheduleId) {
    const s = await db.timetableSchedule.findFirst({ where: { id: klass.timetableScheduleId, schoolId }, include: { periods: { orderBy: { position: "asc" } } } });
    if (s) return s;
  }
  const d = await defaultSchedule(db, schoolId);
  return db.timetableSchedule.findUnique({ where: { id: d.id }, include: { periods: { orderBy: { position: "asc" } } } });
}

/** Everything a settings screen needs: days, every schedule with its periods and classes, rooms, subjects. */
export async function getSetup(schoolId) {
  await defaultSchedule(prisma, schoolId);
  const [days, schedules, rooms, subjects] = await Promise.all([
    getDays(prisma, schoolId),
    prisma.timetableSchedule.findMany({
      where: { schoolId },
      include: { periods: { orderBy: { position: "asc" } }, classes: { where: { isActive: true }, select: { id: true } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.room.findMany({ where: { schoolId }, orderBy: { name: "asc" }, select: { id: true, name: true, capacity: true, isActive: true } }),
    prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    days,
    schedules: schedules.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, periods: s.periods.map(shapePeriod), classIds: s.classes.map((c) => c.id) })),
    rooms,
    subjects,
  };
}

const lostLessons = async (tx, removeLessons, where, what) => {
  const n = await tx.lesson.count({ where });
  if (n && !removeLessons) {
    throw httpError(409, `This removes ${n} lesson${n === 1 ? "" : "s"} already on the timetable (${what}). Save again to confirm.`, { code: "TIMETABLE_HAS_LESSONS", lessons: n });
  }
  if (n) await tx.lesson.deleteMany({ where });
  return n;
};

export async function saveDays(schoolId, input, { removeLessons = false } = {}) {
  const r = readDays(input);
  if (r.error) throw httpError(400, r.error);
  return write(schoolId, async (tx) => {
    const removed = await lostLessons(tx, removeLessons, { schoolId, day: { notIn: r.days } }, "on a day you took out");
    await tx.schoolSettings.upsert({ where: { schoolId }, create: { schoolId, timetableDays: r.days }, update: { timetableDays: r.days } });
    return { days: r.days, removedLessons: removed };
  });
}

/**
 * Creates (scheduleId null) or replaces a schedule. Keeps existing periods by
 * id so their lessons stay put; asks before removing lessons (a period taken
 * out, made a break, or no longer running on a day that has lessons).
 */
export async function saveSchedule(schoolId, scheduleId, input, { removeLessons = false } = {}) {
  const r = readSchedule(input);
  if (r.error) throw httpError(400, r.error);
  return write(schoolId, async (tx) => {
    let schedule;
    if (scheduleId) {
      schedule = await tx.timetableSchedule.findFirst({ where: { id: String(scheduleId), schoolId } });
      if (!schedule) throw httpError(404, "School day not found.");
    }
    const clash = await tx.timetableSchedule.findFirst({ where: { schoolId, name: r.name, ...(schedule ? { id: { not: schedule.id } } : {}) } });
    if (clash) throw httpError(409, `There's already a school day called "${r.name}".`);
    if (!schedule) {
      const any = await tx.timetableSchedule.count({ where: { schoolId } });
      schedule = await tx.timetableSchedule.create({ data: { schoolId, name: r.name, isDefault: any === 0 } });
    } else if (schedule.name !== r.name) {
      await tx.timetableSchedule.update({ where: { id: schedule.id }, data: { name: r.name } });
    }

    const existing = await tx.timetablePeriod.findMany({ where: { scheduleId: schedule.id } });
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const p of r.periods) if (p.id && !byId.has(p.id)) throw httpError(400, "One of the periods doesn't belong to this school day.");
    const kept = new Map(r.periods.filter((p) => p.id).map((p) => [p.id, p]));
    const dropped = existing.filter((p) => !kept.has(p.id)).map((p) => p.id);

    // Lessons that would no longer fit: in a dropped period, in a period made
    // a break, or on a day a period no longer runs.
    const or = [];
    if (dropped.length) or.push({ periodId: { in: dropped } });
    for (const [id, p] of kept) {
      if (p.kind === "BREAK" && byId.get(id).kind === "LESSON") or.push({ periodId: id });
      else if (p.days.length) or.push({ periodId: id, day: { notIn: p.days } });
    }
    const removed = or.length ? await lostLessons(tx, removeLessons, { schoolId, OR: or }, "in a period you took out, made a break, or no longer run on that day") : 0;

    if (dropped.length) await tx.timetablePeriod.deleteMany({ where: { id: { in: dropped } } });
    for (const p of kept.values()) await tx.timetablePeriod.update({ where: { id: p.id }, data: { position: 1000 + p.position } });
    for (const p of r.periods) {
      const data = { position: p.position, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, kind: p.kind, days: p.days };
      if (p.id) await tx.timetablePeriod.update({ where: { id: p.id }, data });
      else await tx.timetablePeriod.create({ data: { schoolId, scheduleId: schedule.id, ...data } });
    }
    const saved = await tx.timetablePeriod.findMany({ where: { scheduleId: schedule.id }, orderBy: { position: "asc" } });
    return { id: schedule.id, name: r.name, periods: saved.map(shapePeriod), removedLessons: removed };
  });
}

export async function makeDefaultSchedule(schoolId, scheduleId) {
  return write(schoolId, async (tx) => {
    const s = await tx.timetableSchedule.findFirst({ where: { id: String(scheduleId), schoolId } });
    if (!s) throw httpError(404, "School day not found.");
    await tx.timetableSchedule.updateMany({ where: { schoolId }, data: { isDefault: false } });
    await tx.timetableSchedule.update({ where: { id: s.id }, data: { isDefault: true } });
    return { ok: true };
  });
}

/** Deletes a schedule (not the default); its classes move to the default; their lessons there go (asks first). */
export async function deleteSchedule(schoolId, scheduleId, { removeLessons = false } = {}) {
  return write(schoolId, async (tx) => {
    const s = await tx.timetableSchedule.findFirst({ where: { id: String(scheduleId), schoolId } });
    if (!s) throw httpError(404, "School day not found.");
    if (s.isDefault) throw httpError(400, "Make another school day the default before deleting this one.");
    const removed = await lostLessons(tx, removeLessons, { schoolId, period: { scheduleId: s.id } }, "in this school day");
    await tx.class.updateMany({ where: { schoolId, timetableScheduleId: s.id }, data: { timetableScheduleId: null } });
    await tx.timetableSchedule.delete({ where: { id: s.id } });
    return { removedLessons: removed };
  });
}

/** Puts a class on a schedule. Its lessons belong to the old schedule's periods, so they go (asks first). */
export async function setClassSchedule(schoolId, classId, scheduleId, { removeLessons = false } = {}) {
  return write(schoolId, async (tx) => {
    const klass = await tx.class.findFirst({ where: { id: String(classId), schoolId } });
    if (!klass) throw httpError(404, "Class not found.");
    let target = null;
    if (scheduleId) {
      target = await tx.timetableSchedule.findFirst({ where: { id: String(scheduleId), schoolId } });
      if (!target) throw httpError(404, "School day not found.");
    }
    const current = await scheduleOf(tx, schoolId, klass);
    const next = target || (await defaultSchedule(tx, schoolId));
    if (current.id === next.id) {
      await tx.class.update({ where: { id: klass.id }, data: { timetableScheduleId: target ? target.id : null } });
      return { removedLessons: 0 };
    }
    const removed = await lostLessons(tx, removeLessons, { schoolId, classId: klass.id }, `${classLabel(klass)}'s current timetable, which uses the other school day's periods`);
    await tx.class.update({ where: { id: klass.id }, data: { timetableScheduleId: target ? target.id : null } });
    return { removedLessons: removed };
  });
}

/* ------------------------------------------------------------------ */
/* Rooms and teacher rules                                             */
/* ------------------------------------------------------------------ */

const roomName = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

export async function saveRoom(schoolId, roomId, body) {
  const name = roomName(body?.name);
  if (!name) throw httpError(400, "Give the room a name.");
  const capacity = body?.capacity == null || body.capacity === "" ? null : Number(body.capacity);
  if (capacity != null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000)) throw httpError(400, "Capacity must be a whole number.");
  const data = { name, capacity, ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}) };
  try {
    if (!roomId) return await prisma.room.create({ data: { schoolId, ...data } });
    const r = await prisma.room.findFirst({ where: { id: String(roomId), schoolId } });
    if (!r) throw httpError(404, "Room not found.");
    return await prisma.room.update({ where: { id: r.id }, data });
  } catch (e) {
    if (e?.code === "P2002") throw httpError(409, `There's already a room called "${name}".`);
    throw e;
  }
}

export async function deleteRoom(schoolId, roomId) {
  const r = await prisma.room.findFirst({ where: { id: String(roomId), schoolId } });
  if (!r) throw httpError(404, "Room not found.");
  await prisma.room.delete({ where: { id: r.id } }); // lessons keep their slot, lose the room
  return { ok: true };
}

export async function getTeacherRules(schoolId, teacherId) {
  const t = await prisma.teacher.findFirst({ where: { id: String(teacherId), schoolId }, select: { id: true, firstName: true, lastName: true, maxLessonsPerDay: true } });
  if (!t) throw httpError(404, "Teacher not found.");
  const blocks = await prisma.teacherBlock.findMany({ where: { schoolId, teacherId: t.id }, orderBy: [{ day: "asc" }, { startsAt: "asc" }] });
  return { teacher: { id: t.id, name: teacherName(t) }, maxLessonsPerDay: t.maxLessonsPerDay, blocks: blocks.map((b) => ({ id: b.id, day: b.day, startsAt: b.startsAt, endsAt: b.endsAt, note: b.note })) };
}

/** Replaces a teacher's daily maximum and unavailable times. Refuses if lessons already sit in them. */
export async function saveTeacherRules(schoolId, teacherId, body) {
  const max = body?.maxLessonsPerDay == null || body.maxLessonsPerDay === "" ? null : Number(body.maxLessonsPerDay);
  if (max != null && (!Number.isInteger(max) || max < 1 || max > 16)) throw httpError(400, "Lessons a day must be a whole number from 1 to 16.");
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  for (const b of blocks) {
    if (!Number.isInteger(Number(b.day)) || b.day < 1 || b.day > 6) throw httpError(400, "Unavailable times need a day from Monday to Saturday.");
    if (Number.isNaN(timeToMinutes(b.startsAt)) || Number.isNaN(timeToMinutes(b.endsAt)) || timeToMinutes(b.endsAt) <= timeToMinutes(b.startsAt)) {
      throw httpError(400, "Unavailable times need a start and a later end, like 14:00 to 16:30.");
    }
  }
  return write(schoolId, async (tx) => {
    const t = await tx.teacher.findFirst({ where: { id: String(teacherId), schoolId } });
    if (!t) throw httpError(404, "Teacher not found.");
    const year = await currentTimetableYear(schoolId);
    const lessons = await tx.lesson.findMany({ where: { schoolId, teacherId: t.id, year }, include: lessonInclude });
    for (const b of blocks) {
      const hit = lessons.find((l) => l.day === Number(b.day) && overlaps(l.period.startsAt, l.period.endsAt, b.startsAt, b.endsAt));
      if (hit) throw httpError(409, `${teacherName(t)} already teaches ${classLabel(hit.class)} on ${DAY_NAMES[hit.day]} at ${hit.period.startsAt}. Move that lesson first.`);
    }
    if (max != null) {
      const perDay = new Map();
      for (const l of lessons) perDay.set(l.day, (perDay.get(l.day) || new Set()).add(l.linkId || l.id));
      const over = [...perDay].find(([, set]) => set.size > max);
      if (over) throw httpError(409, `${teacherName(t)} already has ${over[1].size} lessons on ${DAY_NAMES[over[0]]}, more than ${max}.`);
    }
    await tx.teacher.update({ where: { id: t.id }, data: { maxLessonsPerDay: max } });
    await tx.teacherBlock.deleteMany({ where: { schoolId, teacherId: t.id } });
    if (blocks.length) {
      await tx.teacherBlock.createMany({
        data: blocks.map((b) => ({ schoolId, teacherId: t.id, day: Number(b.day), startsAt: b.startsAt, endsAt: b.endsAt, note: b.note ? String(b.note).slice(0, 80) : null })),
      });
    }
    return getTeacherRules(schoolId, t.id);
  });
}

/* ------------------------------------------------------------------ */
/* Clash checks                                                        */
/* ------------------------------------------------------------------ */

/**
 * The first clash a lesson would cause, as a sentence, or null.
 * cand: { classId, year, day, startsAt, endsAt, group, teacherId, roomId, linkId }
 * ignore: lesson ids to leave out (the lesson being replaced or moved).
 * extra: lessons not saved yet (auto-fill), same shape as cand plus labels.
 */
async function clashFor(tx, schoolId, cand, { ignore = [], extra = [] } = {}) {
  const others = [
    ...(await tx.lesson.findMany({ where: { schoolId, year: cand.year, day: cand.day, id: { notIn: ignore } }, include: lessonInclude })).map((l) => ({
      ...l,
      startsAt: l.period.startsAt,
      endsAt: l.period.endsAt,
      classText: classLabel(l.class),
      subjectText: l.subject?.name,
      teacherText: teacherName(l.teacher),
      roomText: l.room?.name,
    })),
    ...extra.filter((x) => x.day === cand.day),
  ].filter((o) => overlaps(o.startsAt, o.endsAt, cand.startsAt, cand.endsAt));
  const when = `${DAY_NAMES[cand.day]} ${cand.startsAt}-${cand.endsAt}`;
  const linked = (o) => cand.linkId && o.linkId === cand.linkId;

  for (const o of others) {
    if (o.classId === cand.classId && (!o.group || !cand.group || o.group === cand.group)) {
      return { code: "CLASS_CLASH", message: `${o.classText} already has ${o.subjectText}${o.group ? ` (${o.group})` : ""} on ${when}.` };
    }
  }
  if (cand.teacherId) {
    const o = others.find((x) => x.teacherId === cand.teacherId && !linked(x));
    if (o) return { code: "TEACHER_CLASH", message: `${o.teacherText} already teaches ${o.classText} (${o.subjectText}) on ${when}.` };
    const blocks = await tx.teacherBlock.findMany({ where: { schoolId, teacherId: cand.teacherId, day: cand.day } });
    const b = blocks.find((x) => overlaps(x.startsAt, x.endsAt, cand.startsAt, cand.endsAt));
    if (b) return { code: "TEACHER_UNAVAILABLE", message: `The teacher isn't available on ${DAY_NAMES[cand.day]} ${b.startsAt}-${b.endsAt}${b.note ? ` (${b.note})` : ""}.` };
    const t = await tx.teacher.findUnique({ where: { id: cand.teacherId }, select: { maxLessonsPerDay: true, firstName: true, lastName: true } });
    if (t?.maxLessonsPerDay) {
      const all = [
        ...(await tx.lesson.findMany({ where: { schoolId, year: cand.year, day: cand.day, teacherId: cand.teacherId, id: { notIn: ignore } }, select: { id: true, linkId: true } })),
        ...extra.filter((x) => x.day === cand.day && x.teacherId === cand.teacherId),
      ];
      const distinct = new Set(all.map((x) => x.linkId || x.id));
      if (!(cand.linkId && distinct.has(cand.linkId)) && distinct.size + 1 > t.maxLessonsPerDay) {
        return { code: "TEACHER_MAX", message: `${teacherName(t)} would have more than ${t.maxLessonsPerDay} lessons on ${DAY_NAMES[cand.day]}.` };
      }
    }
  }
  if (cand.roomId) {
    const o = others.find((x) => x.roomId === cand.roomId && !linked(x));
    if (o) return { code: "ROOM_CLASH", message: `${o.roomText} is already used by ${o.classText} on ${when}.` };
  }
  return null;
}

const refuse = (c) => {
  throw httpError(409, c.message, { code: c.code });
};

/* ------------------------------------------------------------------ */
/* A class's timetable                                                 */
/* ------------------------------------------------------------------ */

async function findClass(db, schoolId, classId) {
  const klass = await db.class.findFirst({ where: { id: String(classId), schoolId }, select: { id: true, name: true, stream: true, year: true, isActive: true, timetableScheduleId: true } });
  if (!klass) throw httpError(404, "Class not found.");
  return klass;
}

/** The class's week, its school day, who teaches what (targets, rooms, blocks) and anything that needs attention. */
export async function getClassTimetable(schoolId, classId) {
  const klass = await findClass(prisma, schoolId, classId);
  const [days, schedule, lessons, assignments, subjects, rooms] = await Promise.all([
    getDays(prisma, schoolId),
    scheduleOf(prisma, schoolId, klass),
    prisma.lesson.findMany({ where: { schoolId, classId: klass.id }, include: lessonInclude, orderBy: { group: "asc" } }),
    prisma.teachingAssignment.findMany({
      where: { schoolId, classId: klass.id, isActive: true, subject: { isActive: true } },
      include: { subject: { select: { id: true, name: true } }, teacher: { select: { id: true, firstName: true, lastName: true } }, room: { select: { id: true, name: true } } },
    }),
    prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.room.findMany({ where: { schoolId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const periodById = new Map(schedule.periods.map((p) => [p.id, p]));

  const load = assignments
    .map((a) => ({
      assignmentId: a.id,
      subjectId: a.subjectId,
      subject: a.subject.name,
      teacherId: a.teacherId,
      teacher: teacherName(a.teacher),
      lessonsPerWeek: a.lessonsPerWeek,
      doublesPerWeek: a.doublesPerWeek,
      roomId: a.roomId,
      room: a.room?.name || null,
      optionBlock: a.optionBlock,
      placed: lessons.filter((l) => l.subjectId === a.subjectId && l.teacherId === a.teacherId).length,
    }))
    .sort((x, y) => x.subject.localeCompare(y.subject) || String(x.teacher).localeCompare(String(y.teacher)));

  const warnings = [];
  const assigned = new Set(assignments.map((a) => `${a.subjectId}|${a.teacherId}`));
  for (const l of lessons) {
    const when = `${DAY_NAMES[l.day]} ${periodById.get(l.periodId)?.label ?? ""}`.trim();
    if (!periodById.has(l.periodId)) warnings.push({ kind: "OTHER_SCHEDULE", message: `${l.subject?.name} on ${DAY_NAMES[l.day]} sits in a period of another school day.` });
    if (!l.teacherId) warnings.push({ kind: "NO_TEACHER", message: `${l.subject?.name} on ${when} has no teacher.` });
    else if (!assigned.has(`${l.subjectId}|${l.teacherId}`)) warnings.push({ kind: "NOT_ASSIGNED", message: `${l.subject?.name} on ${when}: ${teacherName(l.teacher)} is no longer assigned to teach it here.` });
  }
  for (const a of load) {
    if (a.lessonsPerWeek == null) continue;
    if (a.placed < a.lessonsPerWeek) warnings.push({ kind: "SHORT", message: `${a.subject}: ${a.placed} of ${a.lessonsPerWeek} lessons placed.` });
    if (a.placed > a.lessonsPerWeek) warnings.push({ kind: "OVER", message: `${a.subject}: ${a.placed} lessons placed, target ${a.lessonsPerWeek}.` });
  }
  const perDay = new Map();
  for (const l of lessons) perDay.set(`${l.subjectId}|${l.group}|${l.day}`, (perDay.get(`${l.subjectId}|${l.group}|${l.day}`) || 0) + 1);
  for (const [k, n] of perDay) {
    if (n < 3) continue;
    const [subjectId, , day] = k.split("|");
    warnings.push({ kind: "HEAVY_DAY", message: `${lessons.find((l) => l.subjectId === subjectId)?.subject?.name} ${n} times on ${DAY_NAMES[day]}.` });
  }

  return {
    class: { id: klass.id, label: classLabel(klass), year: klass.year, isActive: klass.isActive },
    days,
    schedule: { id: schedule.id, name: schedule.name, isDefault: schedule.isDefault },
    periods: schedule.periods.map(shapePeriod),
    subjects,
    rooms,
    lessons: lessons.map(shapeLesson),
    load,
    warnings,
  };
}

/** A period of the class's schedule that runs on that day, or a 400. */
async function periodFor(tx, schoolId, klass, day, periodId) {
  const days = await getDays(tx, schoolId);
  if (!days.includes(day)) throw httpError(400, "That day isn't one of the school's timetable days.");
  const schedule = await scheduleOf(tx, schoolId, klass);
  const p = schedule.periods.find((x) => x.id === String(periodId || ""));
  if (!p) throw httpError(400, `Choose a period from ${classLabel(klass)}'s school day.`);
  if (p.kind !== "LESSON") throw httpError(400, `${p.label} is a break; lessons can't go there.`);
  if (!runsOn(p, day)) throw httpError(400, `${p.label} doesn't run on ${DAY_NAMES[day]}.`);
  return p;
}

/** The teacher for this subject in this class (must be assigned; chosen for you when there's one). */
async function teacherFor(tx, schoolId, klass, subject, teacherId) {
  const assignments = await tx.teachingAssignment.findMany({ where: { schoolId, classId: klass.id, subjectId: subject.id, isActive: true }, select: { teacherId: true, roomId: true } });
  if (!assignments.length) throw httpError(400, `No teacher is assigned to teach ${subject.name} in ${classLabel(klass)}. Assign one in Settings > Curriculum first.`);
  if (!teacherId) {
    if (assignments.length > 1) throw httpError(400, `More than one teacher teaches ${subject.name} in ${classLabel(klass)}; choose which.`);
    return assignments[0];
  }
  const a = assignments.find((x) => x.teacherId === String(teacherId));
  if (!a) throw httpError(400, `That teacher isn't assigned to teach ${subject.name} in ${classLabel(klass)}.`);
  return a;
}

const groupName = (g) => String(g ?? "").replace(/\s+/g, " ").trim().slice(0, 30);

/**
 * Sets one slot of a class: { day, periodId, group?, subjectId|null, teacherId?, roomId?, alsoClassIds? }.
 * subjectId null clears the slot (that group, or the whole class). group makes
 * it one of several parallel lessons (options). alsoClassIds makes it a
 * combined lesson: the same teacher teaches those classes at the same time.
 */
export async function setSlot(schoolId, classId, body = {}) {
  return write(schoolId, async (tx) => {
    const klass = await findClass(tx, schoolId, classId);
    if (!klass.isActive) throw httpError(400, "This class is no longer active.");
    const day = Number(body.day);
    const period = await periodFor(tx, schoolId, klass, day, body.periodId);
    const group = groupName(body.group);
    const existing = await tx.lesson.findFirst({ where: { classId: klass.id, day, periodId: period.id, group } });

    if (body.subjectId == null || body.subjectId === "") {
      if (existing) await tx.lesson.delete({ where: { id: existing.id } });
      return { cleared: true };
    }

    const subject = await tx.subject.findFirst({ where: { id: String(body.subjectId), schoolId, isActive: true }, select: { id: true, name: true } });
    if (!subject) throw httpError(400, "Subject not found.");
    const a = await teacherFor(tx, schoolId, klass, subject, body.teacherId);
    let roomId = body.roomId === undefined ? a.roomId : body.roomId || null;
    if (roomId) {
      const room = await tx.room.findFirst({ where: { id: String(roomId), schoolId, isActive: true } });
      if (!room) throw httpError(400, "Room not found.");
      roomId = room.id;
    }

    // Combined classes: each needs a period at the same time, and the same subject and teacher assigned.
    const also = [...new Set((Array.isArray(body.alsoClassIds) ? body.alsoClassIds : []).map(String))].filter((id) => id !== klass.id);
    const partners = [];
    for (const id of also) {
      const other = await findClass(tx, schoolId, id);
      if (!other.isActive || other.year !== klass.year) throw httpError(400, `${classLabel(other)} isn't an active class of ${klass.year}.`);
      const sched = await scheduleOf(tx, schoolId, other);
      const p = sched.periods.find((x) => x.kind === "LESSON" && runsOn(x, day) && x.startsAt === period.startsAt && x.endsAt === period.endsAt);
      if (!p) throw httpError(400, `${classLabel(other)} has no lesson period at ${period.startsAt}-${period.endsAt} on ${DAY_NAMES[day]}, so it can't join.`);
      const ok = await tx.teachingAssignment.count({ where: { schoolId, classId: other.id, subjectId: subject.id, teacherId: a.teacherId, isActive: true } });
      if (!ok) throw httpError(400, `The same teacher must be assigned to ${subject.name} in ${classLabel(other)} for a combined lesson.`);
      partners.push({ klass: other, period: p });
    }

    const linkId = partners.length ? crypto.randomUUID() : null;
    const ignore = existing ? [existing.id] : [];
    // Replacing a combined lesson in this class unlinks only this class's part.
    const rows = [{ klass, period }, ...partners];
    for (const r of rows) {
      const prev = r.klass.id === klass.id ? existing : await tx.lesson.findFirst({ where: { classId: r.klass.id, day, periodId: r.period.id, group } });
      if (prev && r.klass.id !== klass.id) ignore.push(prev.id);
    }
    for (const r of rows) {
      const c = await clashFor(tx, schoolId, { classId: r.klass.id, year: klass.year, day, startsAt: r.period.startsAt, endsAt: r.period.endsAt, group, teacherId: a.teacherId, roomId, linkId }, { ignore });
      if (c) refuse(c);
    }
    if (ignore.length) await tx.lesson.deleteMany({ where: { id: { in: ignore } } });
    let main = null;
    for (const r of rows) {
      const l = await tx.lesson.create({
        data: { schoolId, classId: r.klass.id, year: klass.year, day, periodId: r.period.id, subjectId: subject.id, teacherId: a.teacherId, roomId, group, linkId },
        include: lessonInclude,
      });
      if (r.klass.id === klass.id) main = l;
    }
    return { lesson: shapeLesson(main), combinedWith: partners.map((p) => classLabel(p.klass)) };
  });
}

/**
 * Moves a lesson to another slot of the same class; if that slot holds a
 * lesson (same group, or the whole class), the two swap. Both are re-checked.
 * body: { from: { day, periodId, group? }, to: { day, periodId } }
 */
export async function moveLesson(schoolId, classId, body = {}) {
  return write(schoolId, async (tx) => {
    const klass = await findClass(tx, schoolId, classId);
    const group = groupName(body.from?.group);
    const fromDay = Number(body.from?.day);
    const toDay = Number(body.to?.day);
    const a = await tx.lesson.findFirst({ where: { classId: klass.id, day: fromDay, periodId: String(body.from?.periodId || ""), group } });
    if (!a) throw httpError(404, "There's no lesson there to move.");
    if (a.linkId) throw httpError(400, "This is a combined lesson with other classes. Clear it and add it again at the new time.");
    const toPeriod = await periodFor(tx, schoolId, klass, toDay, body.to?.periodId);
    const fromPeriod = await tx.timetablePeriod.findUnique({ where: { id: a.periodId } });
    if (toDay === fromDay && toPeriod.id === a.periodId) return { moved: false };
    const b = await tx.lesson.findFirst({ where: { classId: klass.id, day: toDay, periodId: toPeriod.id, group } });
    if (b?.linkId) throw httpError(400, "The lesson there is combined with other classes; clear it first.");
    const blockers = await tx.lesson.count({ where: { classId: klass.id, day: toDay, periodId: toPeriod.id, NOT: { group } } });
    if (blockers && !group) throw httpError(409, "That period has split (group) lessons; move them individually.", { code: "CLASS_CLASH" });

    const ignore = [a.id, ...(b ? [b.id] : [])];
    const aNew = { classId: klass.id, year: klass.year, day: toDay, startsAt: toPeriod.startsAt, endsAt: toPeriod.endsAt, group, teacherId: a.teacherId, roomId: a.roomId };
    const bNew = b && { classId: klass.id, year: klass.year, day: fromDay, startsAt: fromPeriod.startsAt, endsAt: fromPeriod.endsAt, group, teacherId: b.teacherId, roomId: b.roomId };
    const c1 = await clashFor(tx, schoolId, aNew, { ignore, extra: bNew ? [{ ...bNew, classText: classLabel(klass), subjectText: "the swapped lesson" }] : [] });
    if (c1) refuse(c1);
    if (bNew) {
      const c2 = await clashFor(tx, schoolId, bNew, { ignore, extra: [{ ...aNew, classText: classLabel(klass), subjectText: "the moved lesson" }] });
      if (c2) refuse(c2);
    }
    await tx.lesson.deleteMany({ where: { id: { in: ignore } } });
    await tx.lesson.create({ data: { schoolId, classId: klass.id, year: klass.year, day: toDay, periodId: toPeriod.id, subjectId: a.subjectId, teacherId: a.teacherId, roomId: a.roomId, group } });
    if (b) await tx.lesson.create({ data: { schoolId, classId: klass.id, year: klass.year, day: fromDay, periodId: a.periodId, subjectId: b.subjectId, teacherId: b.teacherId, roomId: b.roomId, group } });
    return { moved: true, swapped: !!b };
  });
}

/** Targets per assignment: [{ assignmentId, lessonsPerWeek?, doublesPerWeek?, roomId?, optionBlock? }]. */
export async function setTargets(schoolId, classId, items) {
  const klass = await findClass(prisma, schoolId, classId);
  if (!Array.isArray(items) || !items.length) throw httpError(400, "Send the targets to change.");
  const ids = items.map((i) => String(i?.assignmentId || ""));
  const found = await prisma.teachingAssignment.findMany({ where: { schoolId, classId: klass.id, id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw httpError(400, "One of those subjects isn't taught in this class.");
  const num = (v, max, what) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw httpError(400, `${what} must be a whole number from 0 to ${max}.`);
    return n;
  };
  const updates = [];
  for (const i of items) {
    const data = {};
    if ("lessonsPerWeek" in i) data.lessonsPerWeek = num(i.lessonsPerWeek, MAX_LESSONS_PER_WEEK, "Lessons a week");
    if ("doublesPerWeek" in i) data.doublesPerWeek = num(i.doublesPerWeek, 10, "Doubles a week");
    if ("optionBlock" in i) data.optionBlock = groupName(i.optionBlock) || null;
    if ("roomId" in i) {
      if (i.roomId) {
        const room = await prisma.room.findFirst({ where: { id: String(i.roomId), schoolId } });
        if (!room) throw httpError(400, "Room not found.");
        data.roomId = room.id;
      } else data.roomId = null;
    }
    const lpw = data.lessonsPerWeek;
    if (data.doublesPerWeek && lpw != null && data.doublesPerWeek * 2 > lpw) throw httpError(400, "Doubles take two lessons each, so they can't be more than half the lessons a week.");
    updates.push(prisma.teachingAssignment.update({ where: { id: String(i.assignmentId) }, data }));
  }
  await prisma.$transaction(updates);
  return getClassTimetable(schoolId, klass.id);
}

/* ------------------------------------------------------------------ */
/* Auto-fill and copy forward                                          */
/* ------------------------------------------------------------------ */

/**
 * Plans the remaining lessons of the given classes (all active classes of
 * `year` when classIds is empty), one class after another, sharing teacher
 * and room availability. Option blocks are placed together (one lesson per
 * subject of the block, in parallel groups). With apply, writes it all in one
 * locked transaction, re-checking every lesson.
 */
export async function autofill(schoolId, { classIds = [], year, apply = false } = {}) {
  const run = async (tx) => {
    const days = await getDays(tx, schoolId);
    const classes = classIds.length
      ? await tx.class.findMany({ where: { schoolId, id: { in: classIds.map(String) }, isActive: true }, orderBy: [{ name: "asc" }, { stream: "asc" }] })
      : await tx.class.findMany({ where: { schoolId, isActive: true, ...(year ? { year: Number(year) } : {}) }, orderBy: [{ name: "asc" }, { stream: "asc" }] });
    if (!classes.length) throw httpError(404, "No active class to fill.");
    const years = [...new Set(classes.map((c) => c.year))];
    if (years.length > 1) throw httpError(400, "Fill one academic year at a time.");
    const theYear = years[0];

    // Everything already booked this year, with times, so the plan can't clash.
    const booked = (await tx.lesson.findMany({ where: { schoolId, year: theYear }, include: { period: { select: { startsAt: true, endsAt: true } } } })).map((l) => ({
      id: l.id, classId: l.classId, day: l.day, startsAt: l.period.startsAt, endsAt: l.period.endsAt, group: l.group, teacherId: l.teacherId, roomId: l.roomId, linkId: l.linkId, subjectId: l.subjectId,
    }));
    const blocks = await tx.teacherBlock.findMany({ where: { schoolId } });
    const maxOf = new Map((await tx.teacher.findMany({ where: { schoolId, maxLessonsPerDay: { not: null } }, select: { id: true, maxLessonsPerDay: true } })).map((t) => [t.id, t.maxLessonsPerDay]));
    const assignments = await tx.teachingAssignment.findMany({
      where: { schoolId, classId: { in: classes.map((c) => c.id) }, isActive: true, subject: { isActive: true } },
      include: { subject: { select: { name: true } }, teacher: { select: { firstName: true, lastName: true } } },
    });

    const busyAt = (pred, day, startsAt, endsAt) => booked.some((b) => b.day === day && pred(b) && overlaps(b.startsAt, b.endsAt, startsAt, endsAt));
    const teacherFree = (tid, s) => {
      if (busyAt((b) => b.teacherId === tid, s.day, s.startsAt, s.endsAt)) return false;
      if (blocks.some((b) => b.teacherId === tid && b.day === s.day && overlaps(b.startsAt, b.endsAt, s.startsAt, s.endsAt))) return false;
      const max = maxOf.get(tid);
      if (max && new Set(booked.filter((b) => b.teacherId === tid && b.day === s.day).map((b) => b.linkId || b.id)).size >= max) return false;
      return true;
    };
    const roomFree = (rid, s) => !rid || !busyAt((b) => b.roomId === rid, s.day, s.startsAt, s.endsAt);

    const results = [];
    let seq = 0;
    for (const c of classes) {
      const schedule = await scheduleOf(tx, schoolId, c);
      const slots = lessonSlots(days, schedule.periods);
      const own = assignments.filter((a) => a.classId === c.id);
      const mine = booked.filter((b) => b.classId === c.id);
      // One need per subject, or one per option block (its subjects go side by side).
      const groups = new Map();
      for (const a of own.filter((x) => x.lessonsPerWeek > 0)) {
        const key = a.optionBlock ? `block:${a.optionBlock}` : `a:${a.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      }
      const needs = [...groups.entries()].map(([key, members]) => {
        const isBlock = key.startsWith("block:");
        const placedOf = (a) => mine.filter((l) => l.subjectId === a.subjectId && l.teacherId === a.teacherId).length;
        const count = Math.max(0, Math.min(...members.map((a) => a.lessonsPerWeek - placedOf(a))));
        const used = new Map();
        for (const l of mine.filter((l) => members.some((a) => a.subjectId === l.subjectId))) used.set(l.day, (used.get(l.day) || 0) + 1 / members.length);
        return { key, members, isBlock, count, doubles: Math.min(...members.map((a) => a.doublesPerWeek || 0)), used };
      });
      const classFree = (s) => !booked.some((b) => b.classId === c.id && b.day === s.day && overlaps(b.startsAt, b.endsAt, s.startsAt, s.endsAt));
      const placedRows = [];
      const { placed, unplaced } = planLessons({
        slots,
        needs,
        isFree: (n, s) => classFree(s) && n.members.every((a) => teacherFree(a.teacherId, s) && roomFree(a.roomId, s)),
        take: (n, s) => {
          for (const a of n.members) {
            const row = { id: `new-${seq++}`, classId: c.id, day: s.day, periodId: s.periodId, startsAt: s.startsAt, endsAt: s.endsAt, group: n.isBlock ? a.subject.name.slice(0, 30) : "", teacherId: a.teacherId, roomId: a.roomId, linkId: null, subjectId: a.subjectId };
            booked.push(row);
            placedRows.push(row);
          }
        },
        load: (n, s) => booked.filter((b) => b.day === s.day && (b.classId === c.id || n.members.some((a) => a.teacherId === b.teacherId))).length,
      });
      const nameOf = (key) => groups.get(key).map((a) => `${a.subject.name} (${teacherName(a.teacher)})`).join(" + ");
      results.push({
        class: { id: c.id, label: classLabel(c), year: c.year },
        withoutTargets: own.filter((a) => a.lessonsPerWeek == null).length,
        placed: placed.map((p) => ({ day: p.day, periodId: p.periodId, subject: nameOf(p.key) })),
        unplaced: unplaced.map((u) => ({ subject: nameOf(u.key), missing: u.missing, reason: u.reason })),
        rows: placedRows,
      });
    }

    if (apply) {
      for (const r of results) {
        for (const row of r.rows) {
          await tx.lesson.create({ data: { schoolId, classId: row.classId, year: theYear, day: row.day, periodId: row.periodId, subjectId: row.subjectId, teacherId: row.teacherId, roomId: row.roomId, group: row.group } });
        }
      }
    }
    return {
      year: theYear,
      applied: apply,
      placed: results.reduce((n, r) => n + r.rows.length, 0),
      unplaced: results.reduce((n, r) => n + r.unplaced.reduce((m, u) => m + u.missing, 0), 0),
      classes: results.map(({ rows, ...r }) => r), // eslint-disable-line no-unused-vars
    };
  };
  if (!apply) return run(prisma);
  return write(schoolId, run);
}

/**
 * Starts a year's timetable from another year's: each class is matched by
 * name and stream; lessons copy when the class is on the same school day (or
 * one with a period at the same time), the subject is still taught there
 * (same teacher if still assigned), and nothing clashes. Reports what didn't.
 */
export async function copyForward(schoolId, { fromYear, toYear }) {
  const from = Number(fromYear);
  const to = Number(toYear);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) throw httpError(400, "Choose two different years.");
  return write(schoolId, async (tx) => {
    const [src, dst] = await Promise.all([
      tx.class.findMany({ where: { schoolId, year: from } }),
      tx.class.findMany({ where: { schoolId, year: to, isActive: true } }),
    ]);
    const key = (c) => `${c.name}|${c.stream || ""}`.toLowerCase();
    const target = new Map(dst.map((c) => [key(c), c]));
    const lessons = await tx.lesson.findMany({ where: { schoolId, year: from }, include: lessonInclude, orderBy: [{ day: "asc" }] });
    const links = new Map();
    let copied = 0;
    const skipped = [];
    for (const l of lessons) {
      const sc = src.find((c) => c.id === l.classId);
      const dc = sc && target.get(key(sc));
      const what = `${classLabel(l.class)} ${l.subject?.name} ${DAY_NAMES[l.day]} ${l.period.startsAt}`;
      if (!dc) { skipped.push(`${what}: no ${to} class with that name`); continue; } // prettier-ignore
      if (await tx.lesson.count({ where: { classId: dc.id, day: l.day, periodId: l.periodId, group: l.group } })) continue; // already there
      const sched = await scheduleOf(tx, schoolId, dc);
      const p = sched.periods.find((x) => x.id === l.periodId) || sched.periods.find((x) => x.kind === "LESSON" && runsOn(x, l.day) && x.startsAt === l.period.startsAt && x.endsAt === l.period.endsAt);
      if (!p) { skipped.push(`${what}: no period at that time in ${classLabel(dc)}'s school day`); continue; } // prettier-ignore
      const as = await tx.teachingAssignment.findMany({ where: { schoolId, classId: dc.id, subjectId: l.subjectId, isActive: true } });
      const a = as.find((x) => x.teacherId === l.teacherId) || (as.length === 1 ? as[0] : null);
      if (!a) { skipped.push(`${what}: ${as.length ? "several teachers, none the same" : "subject not assigned"} in ${classLabel(dc)}`); continue; } // prettier-ignore
      const linkId = l.linkId ? links.get(l.linkId) || links.set(l.linkId, crypto.randomUUID()).get(l.linkId) : null;
      const cand = { classId: dc.id, year: to, day: l.day, startsAt: p.startsAt, endsAt: p.endsAt, group: l.group, teacherId: a.teacherId, roomId: l.roomId, linkId };
      const c = await clashFor(tx, schoolId, cand);
      if (c) { skipped.push(`${what}: ${c.message}`); continue; } // prettier-ignore
      await tx.lesson.create({ data: { schoolId, classId: dc.id, year: to, day: l.day, periodId: p.id, subjectId: l.subjectId, teacherId: a.teacherId, roomId: l.roomId, group: l.group, linkId } });
      copied += 1;
    }
    return { copied, skipped: skipped.length, details: skipped.slice(0, 50) };
  });
}

/* ------------------------------------------------------------------ */
/* A teacher's week, "my" timetable, today                             */
/* ------------------------------------------------------------------ */

/** The school's current academic year (settings), else this calendar year. */
export async function currentTimetableYear(schoolId) {
  const cal = await getSchoolCalendar(schoolId);
  return Number(cal.currentYear) || Number(localDateString(new Date(), cal.timezone).slice(0, 4));
}

/**
 * Columns for a view that mixes school days (a teacher across classes): the
 * default day's periods, plus any other lesson time used, merged by time.
 * Lessons get periodId = their column.
 */
async function mergedColumns(schoolId, lessons) {
  const def = await scheduleOf(prisma, schoolId, null);
  const cols = new Map(def.periods.map((p) => [`${p.startsAt}-${p.endsAt}`, { ...shapePeriod(p), id: `${p.startsAt}-${p.endsAt}`, days: [] }]));
  for (const l of lessons) {
    const k = `${l.period.startsAt}-${l.period.endsAt}`;
    if (!cols.has(k)) cols.set(k, { id: k, position: 0, label: l.period.label, startsAt: l.period.startsAt, endsAt: l.period.endsAt, kind: "LESSON", days: [] });
  }
  const periods = [...cols.values()].sort((a, z) => timeToMinutes(a.startsAt) - timeToMinutes(z.startsAt) || timeToMinutes(a.endsAt) - timeToMinutes(z.endsAt));
  // Drop default breaks that a lesson column overlaps, so the grid stays readable.
  const lessonCols = periods.filter((p) => p.kind === "LESSON");
  const shown = periods.filter((p) => p.kind === "LESSON" || !lessonCols.some((x) => overlaps(x.startsAt, x.endsAt, p.startsAt, p.endsAt)));
  return { periods: shown.map((p, i) => ({ ...p, position: i + 1 })), lessons: lessons.map((l) => ({ ...shapeLesson(l), periodId: `${l.period.startsAt}-${l.period.endsAt}` })) };
}

export async function getTeacherTimetable(schoolId, teacherId, { year } = {}) {
  const teacher = await prisma.teacher.findFirst({ where: { id: String(teacherId), schoolId }, select: { id: true, firstName: true, lastName: true, maxLessonsPerDay: true } });
  if (!teacher) throw httpError(404, "Teacher not found.");
  const theYear = year ? Number(year) : await currentTimetableYear(schoolId);
  const [days, raw, subjects, blocks] = await Promise.all([
    getDays(prisma, schoolId),
    prisma.lesson.findMany({ where: { schoolId, teacherId: teacher.id, year: theYear }, include: lessonInclude }),
    prisma.subject.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.teacherBlock.findMany({ where: { schoolId, teacherId: teacher.id }, orderBy: [{ day: "asc" }, { startsAt: "asc" }] }),
  ]);
  // A combined lesson shows once, naming every class.
  const byLink = new Map();
  const shown = [];
  for (const l of raw) {
    if (!l.linkId) shown.push(l);
    else if (!byLink.has(l.linkId)) {
      byLink.set(l.linkId, l);
      shown.push(l);
    }
  }
  const { periods, lessons } = await mergedColumns(schoolId, shown);
  for (const l of lessons) {
    if (!l.linkId) continue;
    const labels = raw.filter((x) => x.linkId === l.linkId).map((x) => classLabel(x.class));
    l.class = { ...l.class, label: labels.join(" + ") };
  }
  const perDay = Object.fromEntries(days.map((d) => [d, lessons.filter((l) => l.day === d).length]));
  return {
    teacher: { id: teacher.id, name: teacherName(teacher), maxLessonsPerDay: teacher.maxLessonsPerDay },
    year: theYear,
    days,
    periods,
    subjects,
    lessons,
    blocks: blocks.map((b) => ({ id: b.id, day: b.day, startsAt: b.startsAt, endsAt: b.endsAt, note: b.note })),
    totals: { week: lessons.length, perDay },
  };
}

async function learnersOf(schoolId, studentIds) {
  if (!studentIds.length) return [];
  return prisma.student.findMany({ where: { schoolId, id: { in: studentIds }, isActive: true }, select: { id: true, firstName: true, lastName: true, classId: true }, orderBy: { firstName: "asc" } });
}

/** The caller's own timetable: a teacher's week, or each learner's class week. */
export async function getMine(schoolId, { role, teacherId, studentIds = [] }) {
  if (role === "TEACHER") {
    if (!teacherId) throw httpError(404, "Your account isn't linked to a teacher record.");
    return { kind: "teacher", ...(await getTeacherTimetable(schoolId, teacherId)) };
  }
  const out = [];
  for (const st of await learnersOf(schoolId, studentIds)) {
    let timetable = null;
    if (st.classId) {
      const { load, warnings, ...t } = await getClassTimetable(schoolId, st.classId); // eslint-disable-line no-unused-vars
      timetable = t;
    }
    out.push({ learner: { id: st.id, name: `${st.firstName} ${st.lastName}`.trim() }, timetable });
  }
  return { kind: "learners", learners: out };
}

/** Today's lessons for the caller, with the time now in the school. */
export async function getToday(schoolId, who) {
  const cal = await getSchoolCalendar(schoolId);
  const now = new Date();
  const today = localDateString(now, cal.timezone);
  const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: cal.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const days = await getDays(prisma, schoolId);
  const base = { date: today, day: weekday, dayName: DAY_NAMES[weekday] || "Sunday", now: time, schoolDay: days.includes(weekday) };
  const sortByTime = (a, z) => timeToMinutes(a.startsAt) - timeToMinutes(z.startsAt);

  if (who.role === "TEACHER" || who.role === "ADMIN") {
    if (!who.teacherId) return { ...base, lessons: [] };
    const year = await currentTimetableYear(schoolId);
    const raw = await prisma.lesson.findMany({ where: { schoolId, teacherId: who.teacherId, year, day: weekday }, include: lessonInclude });
    const seen = new Set();
    const lessons = [];
    for (const l of raw) {
      if (l.linkId && seen.has(l.linkId)) continue;
      if (l.linkId) seen.add(l.linkId);
      const s = shapeLesson(l);
      if (l.linkId) s.class = { ...s.class, label: raw.filter((x) => x.linkId === l.linkId).map((x) => classLabel(x.class)).join(" + ") };
      lessons.push(s);
    }
    return { ...base, lessons: lessons.sort(sortByTime) };
  }
  const learners = await learnersOf(schoolId, who.studentIds || []);
  const classIds = [...new Set(learners.map((l) => l.classId).filter(Boolean))];
  const lessons = classIds.length ? await prisma.lesson.findMany({ where: { schoolId, classId: { in: classIds }, day: weekday }, include: lessonInclude }) : [];
  return {
    ...base,
    learners: learners.map((st) => ({ id: st.id, name: `${st.firstName} ${st.lastName}`.trim(), lessons: lessons.filter((l) => l.classId === st.classId).map(shapeLesson).sort(sortByTime) })),
  };
}
