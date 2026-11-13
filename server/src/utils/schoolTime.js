// src/utils/schoolTime.js
// Dates as the school experiences them. A school's "today" and "this day"
// are in its own time zone (default Africa/Nairobi, UTC+3), not UTC — a
// payment at 01:00 in Nairobi belongs to that day's cash-up, not the
// previous one (audit finding M3).
import { prisma } from "../lib/prisma.js";

export const DEFAULT_TZ = "Africa/Nairobi";

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(tz) });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" for an instant, as seen in the time zone. */
export function localDateString(instant = new Date(), tz = DEFAULT_TZ) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Minutes the zone is ahead of UTC at that instant (Nairobi: +180). */
function offsetMinutes(instant, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The UTC instant at which local midnight of dateStr starts in tz. */
export function startOfLocalDay(dateStr, tz = DEFAULT_TZ) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  let start = new Date(guess.getTime() - offsetMinutes(guess, tz) * 60000);
  // Re-check once in case the offset differs at the corrected instant (DST zones).
  start = new Date(guess.getTime() - offsetMinutes(start, tz) * 60000);
  return start;
}

/**
 * UTC instants covering local days [fromStr .. toStr] inclusive:
 * { from: start of fromStr, to: last millisecond of toStr }.
 */
export function localDayRange(fromStr, toStr = fromStr, tz = DEFAULT_TZ) {
  const from = startOfLocalDay(fromStr, tz);
  const [y, m, d] = String(toStr).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const to = new Date(startOfLocalDay(next, tz).getTime() - 1);
  return { from, to };
}

export function isDateString(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The term whose dates contain dateStr ("YYYY-MM-DD"), or null. */
export function termForDate(termDates, dateStr) {
  return (
    (termDates || []).find((t) => {
      const s = t.startsOn.toISOString().slice(0, 10);
      const e = t.endsOn.toISOString().slice(0, 10);
      return dateStr >= s && dateStr <= e;
    }) || null
  );
}

// Calendar per school, cached briefly: read on most requests that deal in dates.
const CACHE = new Map();
const TTL_MS = 30_000;

export function invalidateSchoolCalendar(schoolId) {
  CACHE.delete(String(schoolId));
}

/**
 * { timezone, currentYear, currentTerm, termLabels, termDates } for a school.
 * currentYear is a number (first year of "2025/2026" style values).
 */
export async function getSchoolCalendar(schoolId) {
  const key = String(schoolId);
  const hit = CACHE.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const [settings, termDates] = await Promise.all([
    prisma.schoolSettings.findUnique({
      where: { schoolId: key },
      select: {
        timezone: true,
        currentAcademicYear: true,
        currentTerm: true,
        term1Label: true,
        term2Label: true,
        term3Label: true,
      },
    }),
    prisma.termDate.findMany({ where: { schoolId: key }, orderBy: [{ year: "asc" }, { startsOn: "asc" }] }),
  ]);

  const timezone = settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : DEFAULT_TZ;
  const yearNum = parseInt(String(settings?.currentAcademicYear || ""), 10);
  const today = localDateString(new Date(), timezone);
  const byDate = termForDate(termDates, today);

  const data = {
    timezone,
    today,
    currentYear: Number.isFinite(yearNum) ? yearNum : byDate?.year ?? Number(today.slice(0, 4)),
    // An explicit setting wins; otherwise the term whose dates contain today.
    currentTerm: settings?.currentTerm || byDate?.term || null,
    termLabels: {
      TERM1: settings?.term1Label || "Term 1",
      TERM2: settings?.term2Label || "Term 2",
      TERM3: settings?.term3Label || "Term 3",
    },
    termDates,
  };
  CACHE.set(key, { data, exp: Date.now() + TTL_MS });
  return data;
}
