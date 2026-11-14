// src/config/plans.js
// Single source of truth for subscription plan defaults.
// Previously duplicated verbatim in middleware/subscription.js and routes/schools.js —
// keep it here and import everywhere so the two can't silently drift apart.

export const PLAN_DEFAULTS = {
  FREE: { status: "TRIAL", maxStudents: 50, maxTeachers: 10, maxClasses: 5, maxUsers: null },
  BASIC: { status: "ACTIVE", maxStudents: 300, maxTeachers: 30, maxClasses: 15, maxUsers: 15 },
  PRO: { status: "ACTIVE", maxStudents: 1200, maxTeachers: 80, maxClasses: 40, maxUsers: 60 },
  ENTERPRISE: {
    status: "ACTIVE",
    maxStudents: null,
    maxTeachers: null,
    maxClasses: null,
    maxUsers: null,
  },
};

export function normalizePlanCode(planCode) {
  const p = String(planCode || "FREE").toUpperCase();
  return PLAN_DEFAULTS[p] ? p : "FREE";
}

/**
 * Which modules a school's plan includes, for the app's menus. A module is on
 * when the plan grants its read or write entitlement; a trial includes
 * everything. Once a plan lapses (expired, cancelled, past due) the same
 * modules stay visible read-only: reads are allowed, changes are refused.
 * The API still enforces each request; this only decides what is shown.
 */
export const MODULE_KEYS = {
  exams: ["EXAMS_READ", "EXAMS_WRITE"],
  fees: ["FEES_READ", "FEES_WRITE"],
  attendance: ["ATTENDANCE_READ", "ATTENDANCE_WRITE"],
};

/** True when the subscription can't be used for changes: not TRIAL/ACTIVE, or past its end. */
export function isLapsed(sub) {
  if (!sub) return true;
  const status = String(sub.status || "").toUpperCase();
  const expired = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() < Date.now() : false;
  return expired || (status !== "ACTIVE" && status !== "TRIAL");
}

/**
 * Whether the plan includes the module behind an entitlement key, whatever
 * its state: a trial includes everything; otherwise the module's READ or
 * WRITE key. A lapsed plan keeps these modules read-only.
 */
export function planIncludes(sub, key) {
  if (!sub) return false;
  if (String(sub.status || "").toUpperCase() === "TRIAL") return true;
  const ent = sub.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
  const module = Object.values(MODULE_KEYS).find((keys) => keys.includes(key));
  return (module || [key]).some((k) => !!ent[k]);
}

/** { exams, fees, attendance }: the modules the plan includes (read-only once lapsed). */
export function moduleAccess(sub) {
  return Object.fromEntries(Object.entries(MODULE_KEYS).map(([m, keys]) => [m, planIncludes(sub, keys[0])]));
}
