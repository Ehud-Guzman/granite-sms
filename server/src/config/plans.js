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
 * when the subscription is usable (TRIAL or ACTIVE, not past its end) and it
 * grants that module's read or write entitlement; a trial shows everything,
 * matching the entitlement checks (a trial may read every module).
 * The API still enforces each request; this only decides what is shown.
 */
export const MODULE_KEYS = {
  exams: ["EXAMS_READ", "EXAMS_WRITE"],
  fees: ["FEES_READ", "FEES_WRITE"],
  attendance: ["ATTENDANCE_READ", "ATTENDANCE_WRITE"],
};

export function moduleAccess(sub) {
  const off = Object.fromEntries(Object.keys(MODULE_KEYS).map((m) => [m, false]));
  if (!sub) return off;
  const status = String(sub.status || "").toUpperCase();
  const expired = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() < Date.now() : false;
  if (expired || (status !== "ACTIVE" && status !== "TRIAL")) return off;
  if (status === "TRIAL") return Object.fromEntries(Object.keys(MODULE_KEYS).map((m) => [m, true]));
  const ent = sub.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
  return Object.fromEntries(Object.entries(MODULE_KEYS).map(([m, keys]) => [m, keys.some((k) => !!ent[k])]));
}
