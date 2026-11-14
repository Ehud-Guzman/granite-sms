// src/modules/timetable/timetable.rules.js
// The timetable's rules as plain functions (no database), so they can be
// tested on their own: checking bell times, time overlap, and the auto-fill
// planner. The planner decides WHERE lessons go (spread, doubles, option
// blocks); the caller says whether a slot is free (class, teachers, rooms,
// unavailable times, daily maximums), so the same planner serves the app
// and the demo seed.

export const DAY_NAMES = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
export const DAY_SHORT = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
export const MAX_PERIODS = 20;
export const MAX_SAME_SUBJECT_PER_DAY = 2; // one double, never three
export const MAX_LESSONS_PER_WEEK = 20;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:40" -> 520 (minutes after midnight); NaN if it isn't a 24-hour time. */
export function timeToMinutes(t) {
  const m = TIME.exec(String(t || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Do [aStart, aEnd) and [bStart, bEnd) share any minute? Times as "HH:MM". */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

export const slotKey = (day, periodId) => `${day}|${periodId}`;

/** Does this period run on this day? (empty days = every school day) */
export const runsOn = (period, day) => !period.days?.length || period.days.includes(day);

/** School days: 1..6, at least one. Returns { days } or { error }. */
export function readDays(input) {
  if (!Array.isArray(input) || !input.length) return { error: "Choose at least one school day." };
  const days = [...new Set(input.map(Number))].sort((a, z) => a - z);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) return { error: "Days must be Monday (1) to Saturday (6)." };
  return { days };
}

/**
 * Checks one bell schedule. input: { name, periods: [{ id?, label, startsAt, endsAt, kind, days? }] }
 * (days on a period = only those days; empty = every school day).
 * Returns { name, periods } (sorted by start, numbered) or { error }.
 */
export function readSchedule(input) {
  const b = input && typeof input === "object" ? input : {};
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) return { error: "Give the school day a name of up to 40 characters." };
  if (!Array.isArray(b.periods) || !b.periods.length) return { error: "Add the periods of the school day." };
  if (b.periods.length > MAX_PERIODS) return { error: `A day can have at most ${MAX_PERIODS} periods, breaks included.` };

  const periods = [];
  for (const [i, raw] of b.periods.entries()) {
    const p = raw && typeof raw === "object" ? raw : {};
    const label = String(p.label ?? "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 30) return { error: `Row ${i + 1}: give it a name of up to 30 characters (e.g. "1" or "Break").` };
    const start = timeToMinutes(p.startsAt);
    const end = timeToMinutes(p.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end)) return { error: `${label}: times must be like 08:00.` };
    if (end <= start) return { error: `${label}: it must end after it starts.` };
    const kind = p.kind === "BREAK" ? "BREAK" : p.kind === "LESSON" || p.kind == null ? "LESSON" : null;
    if (!kind) return { error: `${label}: type must be LESSON or BREAK.` };
    let days = [];
    if (Array.isArray(p.days) && p.days.length) {
      const r = readDays(p.days);
      if (r.error) return { error: `${label}: ${r.error}` };
      days = r.days;
    }
    periods.push({ id: p.id ? String(p.id) : null, label, startsAt: String(p.startsAt).trim(), endsAt: String(p.endsAt).trim(), kind, days, start });
  }
  periods.sort((a, z) => a.start - z.start);
  // Two periods may share a time only if they never run on the same day.
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i];
      const z = periods[j];
      const sameDay = !a.days.length || !z.days.length || a.days.some((d) => z.days.includes(d));
      if (sameDay && overlaps(a.startsAt, a.endsAt, z.startsAt, z.endsAt)) {
        return { error: `${a.label} (${a.startsAt}-${a.endsAt}) overlaps ${z.label} (${z.startsAt}-${z.endsAt}) on the same day.` };
      }
    }
  }
  if (!periods.some((p) => p.kind === "LESSON")) return { error: "At least one period must be for lessons." };
  const ids = periods.map((p) => p.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return { error: "The same period appears twice." };
  return { name, periods: periods.map(({ start, ...p }, i) => ({ ...p, position: i + 1 })) }; // eslint-disable-line no-unused-vars
}

/**
 * The lesson slots of a schedule over the school days, in order, each knowing
 * the slot right after it on the same day when no break comes between them
 * (for double lessons).
 */
export function lessonSlots(days, periods) {
  const sorted = [...periods].sort((a, z) => a.position - z.position);
  const slots = [];
  for (const day of days) {
    const today = sorted.filter((p) => runsOn(p, day));
    today.forEach((p, i) => {
      if (p.kind !== "LESSON") return;
      const next = today[i + 1];
      const adjacent = next && next.kind === "LESSON" && timeToMinutes(next.startsAt) - timeToMinutes(p.endsAt) <= 5;
      slots.push({ day, periodId: p.id, position: p.position, startsAt: p.startsAt, endsAt: p.endsAt, nextPeriodId: adjacent ? next.id : null });
    });
  }
  return slots;
}

/**
 * Auto-fill planner for one class.
 *   slots:      lessonSlots(...) for the class's schedule
 *   needs:      [{ key, count, doubles, used: Map day -> lessons already that day }]
 *   isFree(need, slot) -> true when the class, its teachers and rooms are all free then
 *   take(need, slot)   records a placed lesson (so later checks see it)
 *   load(need, slot)   -> number, lower = better (to spread teachers' and the class's days)
 * Doubles go first (two back-to-back periods, the day's only lessons of that
 * subject); then singles, one of each subject per round, preferring days the
 * subject isn't on yet. Never three of a subject in a day. Same input, same plan.
 * Returns { placed: [{ key, day, periodId }], unplaced: [{ key, missing, reason }] }.
 */
export function planLessons({ slots, needs, isFree, take, load = () => 0 }) {
  const placed = [];
  const reasons = new Map();
  const used = (n, day) => n.used?.get(day) || 0;
  const bump = (n, day, k = 1) => {
    if (!n.used) n.used = new Map();
    n.used.set(day, used(n, day) + k);
  };
  const put = (n, s) => {
    take(n, s);
    bump(n, s.day);
    placed.push({ key: n.key, day: s.day, periodId: s.periodId });
    n.left -= 1;
  };
  const queue = needs.filter((n) => n.count > 0).map((n) => ({ ...n, left: n.count, doublesLeft: Math.min(n.doubles || 0, Math.floor(n.count / 2)) }));
  const byOrder = (n) => (a, z) => used(n, a.day) - used(n, z.day) || load(n, a) - load(n, z) || a.day - z.day || a.position - z.position;
  const freeCount = (n) => slots.filter((s) => isFree(n, s)).length;
  queue.sort((a, z) => freeCount(a) / a.count - freeCount(z) / z.count || z.count - a.count || String(a.key).localeCompare(String(z.key)));

  // Doubles: a pair on a day the subject isn't on yet.
  for (const n of queue) {
    while (n.doublesLeft > 0 && n.left >= 2) {
      const pairs = slots
        .filter((s) => s.nextPeriodId && used(n, s.day) === 0 && isFree(n, s))
        .filter((s) => {
          const second = slots.find((x) => x.day === s.day && x.periodId === s.nextPeriodId);
          return second && isFree(n, second);
        })
        .sort(byOrder(n));
      if (!pairs.length) {
        reasons.set(n, "No two free periods back to back for a double lesson; placed as singles where possible.");
        break;
      }
      const first = pairs[0];
      put(n, first);
      put(n, slots.find((x) => x.day === first.day && x.periodId === first.nextPeriodId));
      n.doublesLeft -= 1;
    }
  }

  // Singles, round-robin so no subject takes all the good slots first.
  const stuck = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of queue) {
      if (n.left <= 0 || stuck.has(n)) continue;
      const free = slots.filter((s) => isFree(n, s));
      const options = free.filter((s) => used(n, s.day) < MAX_SAME_SUBJECT_PER_DAY).sort(byOrder(n));
      if (!options.length) {
        stuck.add(n);
        reasons.set(n, free.length ? "It would be a third lesson of the subject in one day." : "No period left where the class, the teacher(s) and the room are all free.");
        continue;
      }
      put(n, options[0]);
      progress = true;
    }
  }
  const unplaced = queue.filter((n) => n.left > 0).map((n) => ({ key: n.key, missing: n.left, reason: reasons.get(n) || "No free period left." }));
  return { placed, unplaced };
}
