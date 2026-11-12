// The school's calendar as sent by GET /api/me: time zone, today's date
// there, the current academic year and term. Screens default their filters
// to these instead of hard-coding TERM1 or using the browser's UTC date.
import { useState } from "react";
import { useMe } from "@/hooks/useMe";

export const DEFAULT_TZ = "Africa/Nairobi";

/** "YYYY-MM-DD" today in the given time zone. */
export function todayIn(tz = DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date()
    );
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date());
  }
}

/** "YYYY-MM-DD" of an instant as seen in the school's time zone. */
export function dateIn(instant, tz = DEFAULT_TZ) {
  if (!instant) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant)
  );
}

export function useSchoolCalendar() {
  const { data } = useMe();
  const c = data?.calendar || null;
  const timezone = c?.timezone || DEFAULT_TZ;
  const today = c?.today || todayIn(timezone);
  return {
    loaded: !!c,
    timezone,
    today,
    currentYear: c?.currentYear || Number(today.slice(0, 4)),
    currentTerm: c?.currentTerm || null,
    termLabels: c?.termLabels || { TERM1: "Term 1", TERM2: "Term 2", TERM3: "Term 3" },
    currentTermDates: c?.currentTermDates || null,
  };
}

/**
 * useState for a term filter that starts on the school's current term.
 * Only the user's own pick is stored; until they pick, the value follows the
 * current term (so it is right even if /api/me arrives after first render).
 */
export function useCurrentTermState(fallback = "TERM1") {
  const { currentTerm } = useSchoolCalendar();
  const [picked, setTerm] = useState(null);
  return [picked ?? currentTerm ?? fallback, setTerm];
}

/** useState for a year filter that starts on the school's current academic year. */
export function useCurrentYearState(asString = false) {
  const { currentYear } = useSchoolCalendar();
  const [picked, setYear] = useState(null);
  const value = picked ?? currentYear;
  return [asString ? String(value) : value, setYear];
}
