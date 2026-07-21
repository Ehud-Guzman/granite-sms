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
