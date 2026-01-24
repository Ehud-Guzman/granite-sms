// src/middleware/subscription.js
import { prisma } from "../lib/prisma.js";

// -------------------------------------
// Phase 1 plan defaults
// -------------------------------------
const PLAN_DEFAULTS = {
  FREE: { status: "TRIAL", maxStudents: 50, maxTeachers: 10, maxClasses: 5 },
  BASIC: { status: "ACTIVE", maxStudents: 300, maxTeachers: 30, maxClasses: 15 },
  PRO: { status: "ACTIVE", maxStudents: 1200, maxTeachers: 80, maxClasses: 40 },
  ENTERPRISE: {
    status: "ACTIVE",
    maxStudents: null,
    maxTeachers: null,
    maxClasses: null, // unlimited
  },
};

// -------------------------------------
// Helpers
// -------------------------------------
function normalizePlan(planCode) {
  const p = String(planCode || "FREE").toUpperCase();
  return PLAN_DEFAULTS[p] ? p : "FREE";
}

function isActiveStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "ACTIVE" || s === "TRIAL";
}

function isExpired(sub) {
  if (!sub?.currentPeriodEnd) return false;
  return new Date(sub.currentPeriodEnd).getTime() < Date.now();
}

function capHit(current, cap) {
  if (cap == null) return false; // unlimited
  return current >= cap;
}

function getLimitFromJson(sub, key) {
  const limits = sub?.limits && typeof sub.limits === "object" ? sub.limits : null;
  if (!limits) return undefined;
  const v = limits[key];
  if (v === null) return null; // explicit unlimited
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function effectiveCap(sub, resource) {
  // Prefer JSON override if present, else typed field
  if (resource === "students") {
    const json = getLimitFromJson(sub, "STUDENTS_MAX");
    return json !== undefined ? json : sub.maxStudents;
  }
  if (resource === "teachers") {
    const json = getLimitFromJson(sub, "TEACHERS_MAX");
    return json !== undefined ? json : sub.maxTeachers;
  }
  if (resource === "classes") {
    const json = getLimitFromJson(sub, "CLASSES_MAX");
    return json !== undefined ? json : sub.maxClasses;
  }
  if (resource === "users") {
    const json = getLimitFromJson(sub, "USERS_MAX");
    // Note: some schemas may not have maxUsers typed column yet.
    // If it's absent, json (if set) will be used; otherwise unlimited (null).
    return json !== undefined ? json : ("maxUsers" in sub ? sub.maxUsers : null);
  }
  return null;
}

// -------------------------------------
// Load subscription (tenant-scoped)
// -------------------------------------
export async function loadSubscription(req, res, next) {
  try {
    if (!req.schoolId) {
      return res.status(400).json({ message: "Tenant required" });
    }

    // newest subscription for this school
    let sub = await prisma.subscription.findFirst({
      where: { schoolId: req.schoolId },
      orderBy: { createdAt: "desc" },
    });

    // Auto-heal older schools without subscription
    if (!sub) {
      const school = await prisma.school.findUnique({
        where: { id: req.schoolId },
        select: { id: true, isActive: true },
      });

      if (!school) return res.status(404).json({ message: "School not found" });
      if (!school.isActive)
        return res.status(403).json({ message: "School inactive" });

      const plan = normalizePlan("FREE");
      const d = PLAN_DEFAULTS[plan];

      sub = await prisma.subscription.create({
        data: {
          schoolId: req.schoolId,
          planCode: plan,
          status: d.status,
          maxStudents: d.maxStudents,
          maxTeachers: d.maxTeachers,
          maxClasses: d.maxClasses,
          // entitlements can be added later
        },
      });
    }

    req.subscription = sub;
    next();
  } catch (err) {
    console.error("LOAD SUBSCRIPTION ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// -------------------------------------
// Enforce plan caps (POST only)
// -------------------------------------
export function requireLimit(resource) {
  return async (req, res, next) => {
    try {
      const method = String(req.method || "").toUpperCase();
      if (method !== "POST") return next();

      const sub = req.subscription;

      if (!sub) {
        return res.status(402).json({
          message: "Subscription required.",
          code: "NO_SUBSCRIPTION",
          mode: "READ_ONLY",
        });
      }

      if (!isActiveStatus(sub.status)) {
        return res.status(402).json({
          message: `Subscription not active (${sub.status}).`,
          code: "SUBSCRIPTION_INACTIVE",
          status: sub.status,
          mode: "READ_ONLY",
        });
      }

      if (isExpired(sub)) {
        return res.status(402).json({
          message: "Subscription expired.",
          code: "SUBSCRIPTION_EXPIRED",
          mode: "READ_ONLY",
        });
      }

      const cap = effectiveCap(sub, resource);
      let current = 0;

      if (resource === "students") {
        current = await prisma.student.count({
          where: { schoolId: req.schoolId, isActive: true },
        });
      } else if (resource === "teachers") {
        current = await prisma.teacher.count({
          where: { schoolId: req.schoolId },
        });
      } else if (resource === "classes") {
        current = await prisma.class.count({
          where: { schoolId: req.schoolId, isActive: true },
        });
      } else if (resource === "users") {
        current = await prisma.user.count({
          where: { schoolId: req.schoolId, isActive: true },
        });
      } else {
        return res.status(500).json({ message: "Unknown limit resource" });
      }

      if (capHit(current, cap)) {
        return res.status(409).json({
          message: `Limit reached for ${resource}.`,
          code: "LIMIT_REACHED",
          resource,
          used: current,
          limit: cap,
          planCode: sub.planCode,
          mode: "READ_ONLY",
        });
      }

      next();
    } catch (err) {
      console.error("REQUIRE LIMIT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  };
}

// -------------------------------------
// Entitlements gate
// -------------------------------------
export function requireEntitlement(entitlementKey, opts = {}) {
  const enforceRead = !!opts.enforceRead;

  return (req, res, next) => {
    const method = String(req.method || "").toUpperCase();
    const isRead =
      method === "GET" || method === "HEAD" || method === "OPTIONS";
    if (isRead && !enforceRead) return next();

    const sub = req.subscription;

    if (!sub) {
      return res.status(402).json({
        message: "Subscription required.",
        code: "NO_SUBSCRIPTION",
        mode: "READ_ONLY",
      });
    }

    if (!isActiveStatus(sub.status)) {
      return res.status(402).json({
        message: `Subscription not active (${sub.status}).`,
        code: "SUBSCRIPTION_INACTIVE",
        status: sub.status,
        mode: "READ_ONLY",
      });
    }

    if (isExpired(sub)) {
      return res.status(402).json({
        message: "Subscription expired.",
        code: "SUBSCRIPTION_EXPIRED",
        mode: "READ_ONLY",
      });
    }

    const ent =
      sub.entitlements && typeof sub.entitlements === "object"
        ? sub.entitlements
        : {};

    if (!ent[entitlementKey]) {
      return res.status(403).json({
        message: `Entitlement missing: ${entitlementKey}`,
        code: "ENTITLEMENT_MISSING",
        entitlementKey,
        mode: "READ_ONLY",
      });
    }

    next();
  };
}

export function requireEntitlementRead(entitlementKey) {
  return requireEntitlement(entitlementKey, { enforceRead: true });
}
