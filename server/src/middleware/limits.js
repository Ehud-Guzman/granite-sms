// src/middleware/limits.js
import { prisma } from "../lib/prisma.js";

// -------- helpers --------
function getLimit(sub, key) {
  const raw = sub?.limits?.[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null; // null means "no limit set"
}

function isWrite(req) {
  const m = req.method.toUpperCase();
  return !["GET", "HEAD", "OPTIONS"].includes(m);
}

// By design: only block creates (POST). Updates shouldn't be blocked by "max count".
function isCreate(req) {
  return req.method.toUpperCase() === "POST";
}

// -------- counters (derived, never trusted) --------
async function countStudents(schoolId) {
  return prisma.student.count({ where: { schoolId, isActive: true } });
}
async function countTeachers(schoolId) {
  return prisma.teacher.count({ where: { schoolId } });
}
async function countUsers(schoolId) {
  return prisma.user.count({ where: { schoolId, isActive: true } });
}
async function countClasses(schoolId) {
  return prisma.class.count({ where: { schoolId, isActive: true } });
}

// Central registry so you don’t scatter logic everywhere
const COUNTERS = {
  STUDENTS_MAX: countStudents,
  TEACHERS_MAX: countTeachers,
  USERS_MAX: countUsers,
  CLASSES_MAX: countClasses,
};

// -------- middleware factory --------
export function requireLimit(limitKey) {
  return async (req, res, next) => {
    try {
      // Only enforce on create writes.
      if (!isWrite(req) || !isCreate(req)) return next();

      const schoolId = req.schoolId;
      if (!schoolId) {
        return res.status(400).json({ message: "Tenant required (schoolId missing)." });
      }

      const sub = req.subscription || null;

      // No subscription => keep your current model: READ ONLY for writes
      if (!sub) {
        return res.status(402).json({
          message: "Subscription required for write access.",
          mode: "READ_ONLY",
        });
      }

      const statusOk = sub.status === "ACTIVE" || sub.status === "TRIAL";
      if (!statusOk) {
        return res.status(402).json({
          message: `Subscription not active (${sub.status}).`,
          mode: "READ_ONLY",
        });
      }

      // If limit not configured -> allow (you can tighten later)
      const max = getLimit(sub, limitKey);
      if (max == null) return next();

      const counter = COUNTERS[limitKey];
      if (!counter) {
        return res.status(500).json({ message: `Limit counter not registered: ${limitKey}` });
      }

      const used = await counter(schoolId);

      if (used >= max) {
        return res.status(403).json({
          message: `Limit reached: ${limitKey} (${used}/${max}). Upgrade plan to continue.`,
          code: "LIMIT_REACHED",
          limitKey,
          used,
          max,
        });
      }

      return next();
    } catch (err) {
      console.error("LIMIT ENFORCEMENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  };
}
