// src/modules/timetable/timetable.rules.js
// The timetable's rules as plain functions (no database), so they can be
// tested on their own: checking a school's bell times, and the auto-fill
// planner that places a class's remaining lessons without clashes.

export const DAY_NAMES = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
export const DAY_SHORT = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
export const MAX_PERIODS = 16;
export const MAX_SAME_SUBJECT_PER_DAY = 2; // a double lesson, never three
export const MAX_LESSONS_PER_WEEK = 20;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:40" -> 520 (minutes after midnight); NaN if it isn't a 24-hour time. */
export function timeToMinutes(t) {
  const m = TIME.exec(String(t || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export const slotKey = (day, periodId) => `${day}|${periodId}`;

/**
 * Checks bell times sent by the settings screen.
 * input: { days: [1..6], periods: [{ id?, label, startsAt, endsAt, kind }] }
 * Returns { days, periods } (periods sorted by start, numbered from 1) or { error }.
 */
export function readSetup(input) {
  const b = input && typeof input === "object" ? input : {};

  if (!Array.isArray(b.days) || !b.days.length) return { error: "Choose at least one school day." };
  const days = [...new Set(b.days.map(Number))].sort((a, z) => a - z);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) return { error: "Days must be Monday (1) to Saturday (6)." };

  if (!Array.isArray(b.periods) || !b.periods.length) return { error: "Add the periods of the school day." };
  if (b.periods.length > MAX_PERIODS) return { error: `A day can have at most ${MAX_PERIODS} periods, breaks included.` };

  const periods = [];
  for (const [i, raw] of b.periods.entries()) {
    const p = raw && typeof raw === "object" ? raw : {};
    const n = i + 1;
    const label = String(p.label ?? "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 30) return { error: `Row ${n}: give it a name of up to 30 characters (e.g. "1" or "Break").` };
    const start = timeToMinutes(p.startsAt);
    const end = timeToMinutes(p.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end)) return { error: `${label}: times must be like 08:00 (24-hour clock).` };
    if (end <= start) return { error: `${label}: it must end after it starts.` };
    const kind = p.kind === "BREAK" ? "BREAK" : p.kind === "LESSON" || p.kind == null ? "LESSON" : null;
    if (!kind) return { error: `${label}: type must be LESSON or BREAK.` };
    periods.push({
      id: p.id ? String(p.id) : null,
      label,
      startsAt: String(p.startsAt).trim(),
      endsAt: String(p.endsAt).trim(),
      kind,
      start,
      end,
    });
  }

  periods.sort((a, z) => a.start - z.start);
  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start < periods[i - 1].end) {
      return { error: `${periods[i - 1].label} (${periods[i - 1].startsAt}-${periods[i - 1].endsAt}) overlaps ${periods[i].label} (${periods[i].startsAt}-${periods[i].endsAt}).` };
    }
  }
  if (!periods.some((p) => p.kind === "LESSON")) return { error: "At least one period must be for lessons." };
  const ids = periods.map((p) => p.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return { error: "The same period appears twice." };

  return {
    days,
    periods: periods.map(({ start, end, ...p }, i) => ({ ...p, position: i + 1 })), // eslint-disable-line no-unused-vars
  };
}

/** Room names compare without case or extra spaces: "lab 1" = "LAB  1". Empty -> null. */
export function normaliseRoom(room) {
  const r = String(room ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!r) return null;
  return r.slice(0, 40);
}

/**
 * Auto-fill: places a class's remaining lessons in its empty lesson periods.
 * Never moves or replaces an existing lesson. Rules, in order of priority:
 *   - the class and the teacher must both be free (hard);
 *   - a subject at most twice a day (hard), and preferably once;
 *   - spread each teacher's day and the class's day evenly;
 *   - otherwise the earliest free slot, so the result is the same every time.
 *
 * input:
 *   days:        [1..6] in order
 *   periods:     lesson periods only, [{ id, position }]
 *   needs:       [{ subjectId, teacherId|null, count }]  lessons still to place
 *   classBusy:   Set of slotKey the class already uses
 *   teacherBusy: Map teacherId -> Set of slotKey (every class, this year)
 *   subjectDays: Map subjectId -> Map day -> lessons already that day
 *   teacherDayLoad (optional): Map teacherId -> Map day -> lessons that day
 * Returns { placed: [{ day, periodId, subjectId, teacherId }], unplaced: [{ subjectId, teacherId, missing, reason }] }.
 * The maps and sets passed in are updated as lessons are placed, so several
 * classes can be planned one after another without clashing.
 */
export function planLessons({ days, periods, needs, classBusy, teacherBusy, subjectDays, teacherDayLoad = new Map() }) {
  const slots = [];
  for (const day of days) for (const p of [...periods].sort((a, z) => a.position - z.position)) slots.push({ day, periodId: p.id, position: p.position });

  const busyOf = (teacherId) => {
    if (!teacherId) return new Set();
    if (!teacherBusy.has(teacherId)) teacherBusy.set(teacherId, new Set());
    return teacherBusy.get(teacherId);
  };
  const dayCount = (map, key, day) => map.get(key)?.get(day) || 0;
  const bump = (map, key, day) => {
    if (!map.has(key)) map.set(key, new Map());
    map.get(key).set(day, (map.get(key).get(day) || 0) + 1);
  };
  const classDayLoad = new Map();
  for (const k of classBusy) {
    const day = Number(k.split("|")[0]);
    classDayLoad.set(day, (classDayLoad.get(day) || 0) + 1);
  }

  const free = (n) => slots.filter((s) => !classBusy.has(slotKey(s.day, s.periodId)) && !busyOf(n.teacherId).has(slotKey(s.day, s.periodId)));

  // Most constrained first: fewest free slots per lesson needed.
  const queue = needs
    .filter((n) => n.count > 0)
    .map((n) => ({ ...n, left: n.count }))
    .sort((a, z) => free(a).length / a.count - free(z).length / z.count || z.count - a.count || String(a.subjectId).localeCompare(String(z.subjectId)));

  const placed = [];
  const stuck = new Map(); // need -> reason
  // Round-robin: one lesson of each subject per round, so no subject grabs
  // the best slots before the others get any.
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of queue) {
      if (n.left <= 0 || stuck.has(n)) continue;
      const options = free(n).filter((s) => dayCount(subjectDays, n.subjectId, s.day) < MAX_SAME_SUBJECT_PER_DAY);
      if (!options.length) {
        stuck.set(
          n,
          free(n).length
            ? `It would be a third lesson in one day.`
            : n.teacherId
              ? "No period left where both the class and the teacher are free."
              : "No free period left for this class."
        );
        continue;
      }
      options.sort(
        (a, z) =>
          dayCount(subjectDays, n.subjectId, a.day) - dayCount(subjectDays, n.subjectId, z.day) ||
          (n.teacherId ? dayCount(teacherDayLoad, n.teacherId, a.day) - dayCount(teacherDayLoad, n.teacherId, z.day) : 0) ||
          (classDayLoad.get(a.day) || 0) - (classDayLoad.get(z.day) || 0) ||
          a.day - z.day ||
          a.position - z.position
      );
      const s = options[0];
      const key = slotKey(s.day, s.periodId);
      classBusy.add(key);
      if (n.teacherId) busyOf(n.teacherId).add(key);
      bump(subjectDays, n.subjectId, s.day);
      if (n.teacherId) bump(teacherDayLoad, n.teacherId, s.day);
      classDayLoad.set(s.day, (classDayLoad.get(s.day) || 0) + 1);
      placed.push({ day: s.day, periodId: s.periodId, subjectId: n.subjectId, teacherId: n.teacherId || null });
      n.left -= 1;
      progress = true;
    }
  }

  const unplaced = queue
    .filter((n) => n.left > 0)
    .map((n) => ({ subjectId: n.subjectId, teacherId: n.teacherId || null, missing: n.left, reason: stuck.get(n) || "No free period left." }));
  return { placed, unplaced };
}
