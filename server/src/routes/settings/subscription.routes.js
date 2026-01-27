// src/routes/settings/subscription.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { tenantContext, requireTenant } from "../../middleware/tenant.js";
import { logAudit } from "../../utils/audit.js";
import { invalidateEntitlementsCache } from "../../middleware/entitlements.js";

const router = Router();

// -----------------------------
// Policy + constants
// -----------------------------
const ALLOWED_STATUS = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];
const WRITE_ENABLED_STATUS = new Set(["TRIAL", "ACTIVE"]);
const LIMIT_KEYS = ["STUDENTS_MAX", "TEACHERS_MAX", "CLASSES_MAX", "USERS_MAX"];

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function isSystemAdmin(role) {
  return upper(role) === "SYSTEM_ADMIN";
}

function isExpired(sub) {
  if (!sub?.currentPeriodEnd) return false;
  return new Date(sub.currentPeriodEnd).getTime() < Date.now();
}

function canWriteNow(sub) {
  const st = upper(sub?.status);
  return WRITE_ENABLED_STATUS.has(st) && !isExpired(sub);
}

function parsePlanCode(v) {
  const s = upper(v);
  if (!s) return undefined;
  // Your enum PlanCode controls real validity, but this is fine for UI guard
  if (s.length > 32) return undefined;
  return s;
}

function parseStatus(v) {
  const s = upper(v);
  if (!s) return undefined;
  return ALLOWED_STATUS.includes(s) ? s : undefined;
}

function parseISODateOrNull(v) {
  if (v === null || v === "") return null;
  if (v === undefined) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

// number>=0 | null
function parseCapValue(v) {
  if (v === null) return null;
  if (v === "" || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function getLimitFromJson(sub, key) {
  const limits = sub?.limits && typeof sub.limits === "object" ? sub.limits : null;
  if (!limits) return undefined;
  const v = limits[key];
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Effective cap (matches your middleware logic)
function effectiveCap(sub, resource) {
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
    // NO typed maxUsers in Prisma model => JSON-only
    const json = getLimitFromJson(sub, "USERS_MAX");
    return json !== undefined ? json : null; // null => unlimited
  }
  return null;
}

function percentUsed(used, cap) {
  if (cap == null) return null;
  const c = Number(cap);
  if (!Number.isFinite(c) || c <= 0) return 100;
  const u = Number(used || 0);
  return Math.max(0, Math.min(100, Math.round((u / c) * 100)));
}

function atLimit(used, cap) {
  if (cap == null) return false;
  const c = Number(cap);
  const u = Number(used || 0);
  if (!Number.isFinite(c)) return false;
  return u >= c;
}

async function ensureSubscriptionRow(schoolId) {
  let sub = await prisma.subscription.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });

  if (sub) return sub;

  // Default FREE plan creation (auto-heal)
  sub = await prisma.subscription.create({
    data: {
      schoolId,
      planCode: "FREE",
      status: "TRIAL",
      maxStudents: 50,
      maxTeachers: 10,
      maxClasses: 5,
      limits: null,
      entitlements: {},
      currentPeriodEnd: null,
      canceledAt: null,
      trialEndsAt: null,
    },
  });

  return sub;
}

// -----------------------------
// Router scope rules
// - requireAuth + tenantContext always
// - endpoints requireTenant (x-school-id / token school scope) because this is tenant settings
// -----------------------------
router.use(requireAuth, tenantContext);

// -----------------------------
// GET /api/settings/subscription/overview
// -----------------------------
router.get("/overview", requireTenant, async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const role = upper(req.role);

    const sub = await ensureSubscriptionRow(schoolId);

    // Usage counts (match enforcement policy)
    const [studentsCount, teachersCount, classesCount, usersCount] = await Promise.all([
      prisma.student.count({ where: { schoolId, isActive: true } }),
      prisma.teacher.count({ where: { schoolId } }),
      prisma.class.count({ where: { schoolId, isActive: true } }),
      prisma.user.count({ where: { schoolId, isActive: true } }),
    ]);

    // Effective caps (UI should display the same caps enforcement uses)
    const maxStudents = effectiveCap(sub, "students");
    const maxTeachers = effectiveCap(sub, "teachers");
    const maxClasses = effectiveCap(sub, "classes");
    const maxUsers = effectiveCap(sub, "users"); // JSON-only

    const remaining = {
      studentsRemaining: maxStudents == null ? null : Math.max(Number(maxStudents) - studentsCount, 0),
      teachersRemaining: maxTeachers == null ? null : Math.max(Number(maxTeachers) - teachersCount, 0),
      classesRemaining: maxClasses == null ? null : Math.max(Number(maxClasses) - classesCount, 0),
      usersRemaining: maxUsers == null ? null : Math.max(Number(maxUsers) - usersCount, 0),
    };

    const percent = {
      students: percentUsed(studentsCount, maxStudents),
      teachers: percentUsed(teachersCount, maxTeachers),
      classes: percentUsed(classesCount, maxClasses),
      users: percentUsed(usersCount, maxUsers),
    };

    const atLimitMap = {
      students: atLimit(studentsCount, maxStudents),
      teachers: atLimit(teachersCount, maxTeachers),
      classes: atLimit(classesCount, maxClasses),
      users: atLimit(usersCount, maxUsers),
    };

    const flags = {
      isExpired: isExpired(sub),
      canWrite: canWriteNow(sub),
    };

    return res.json({
      scope: role,
      schoolId,
      subscription: {
        id: sub.id,
        planCode: sub.planCode,
        status: sub.status,
        startsAt: sub.startsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        canceledAt: sub.canceledAt,
        trialEndsAt: sub.trialEndsAt,

        // raw config
        limits: sub.limits ?? null,
        entitlements: sub.entitlements ?? {},

        // ✅ computed effective caps for UI display
        maxStudents,
        maxTeachers,
        maxClasses,
        maxUsers, // computed field (JSON-only)
      },
      usage: { studentsCount, teachersCount, classesCount, usersCount },
      remaining,
      percent,
      atLimit: atLimitMap,
      flags,
    });
  } catch (err) {
    console.error("SUBSCRIPTION OVERVIEW ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// PATCH /api/settings/subscription
// SYSTEM_ADMIN only (tenant scoped)
// body: { planCode?, status?, currentPeriodEnd? (ISO or null) }
// -----------------------------
router.patch("/", requireTenant, async (req, res) => {
  try {
    if (!isSystemAdmin(req.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const schoolId = req.schoolId;
    const sub = await ensureSubscriptionRow(schoolId);

    const planCode = parsePlanCode(req.body?.planCode);
    if (req.body?.planCode !== undefined && planCode === undefined) {
      return res.status(400).json({ message: "Invalid planCode" });
    }

    const status = parseStatus(req.body?.status);
    if (req.body?.status !== undefined && status === undefined) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${ALLOWED_STATUS.join(", ")}`,
      });
    }

    const currentPeriodEnd = parseISODateOrNull(req.body?.currentPeriodEnd);
    if (req.body?.currentPeriodEnd !== undefined && currentPeriodEnd === undefined) {
      return res.status(400).json({ message: "Invalid currentPeriodEnd (ISO date or null)" });
    }

    const data = {
      ...(planCode !== undefined ? { planCode } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(req.body?.currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
    };

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No changes provided" });
    }

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data,
    });

    // ✅ IMPORTANT: bust entitlement cache (status/expiry impacts gating)
    invalidateEntitlementsCache(schoolId);

    await logAudit(req, {
      action: "SETTINGS_SUBSCRIPTION_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: {
        before: {
          planCode: sub.planCode,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
        },
        after: {
          planCode: updated.planCode,
          status: updated.status,
          currentPeriodEnd: updated.currentPeriodEnd,
        },
      },
    });

    return res.json({ ok: true, subscription: updated });
  } catch (err) {
    console.error("SUBSCRIPTION PATCH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// PATCH /api/settings/subscription/limits
// SYSTEM_ADMIN only
// body: { limits: { STUDENTS_MAX?, TEACHERS_MAX?, CLASSES_MAX?, USERS_MAX? } }
// -----------------------------
router.patch("/limits", requireTenant, async (req, res) => {
  try {
    if (!isSystemAdmin(req.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const schoolId = req.schoolId;
    const sub = await ensureSubscriptionRow(schoolId);

    const incoming = req.body?.limits;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "limits must be an object" });
    }

    const prev = sub.limits && typeof sub.limits === "object" ? sub.limits : {};
    const next = { ...prev };

    for (const [k, v] of Object.entries(incoming)) {
      const key = upper(k);
      if (!LIMIT_KEYS.includes(key)) continue;

      const parsed = parseCapValue(v);
      if (parsed === undefined) {
        return res.status(400).json({
          message: `Invalid value for ${key}. Use number >= 0 or null`,
        });
      }
      next[key] = parsed;
    }

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { limits: next },
    });

    // ✅ optional but recommended: keep gating consistent after any sub update
    invalidateEntitlementsCache(schoolId);

    await logAudit(req, {
      action: "SETTINGS_LIMITS_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: { before: prev, after: next },
    });

    return res.json({ ok: true, subscription: updated });
  } catch (err) {
    console.error("SUBSCRIPTION LIMITS PATCH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// PATCH /api/settings/subscription/entitlements
// SYSTEM_ADMIN only
// body: { entitlements: { KEY: true/false } }
// -----------------------------
router.patch("/entitlements", requireTenant, async (req, res) => {
  try {
    if (!isSystemAdmin(req.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const schoolId = req.schoolId;
    const sub = await ensureSubscriptionRow(schoolId);

    const incoming = req.body?.entitlements;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "entitlements must be an object" });
    }

    const prev = sub.entitlements && typeof sub.entitlements === "object" ? sub.entitlements : {};
    const next = { ...prev };

    for (const [k, v] of Object.entries(incoming)) {
      const key = upper(k);
      if (!key || !/^[A-Z0-9_]{3,64}$/.test(key)) {
        return res.status(400).json({ message: `Invalid entitlement key: ${k}` });
      }
      if (typeof v !== "boolean") {
        return res
          .status(400)
          .json({ message: `Invalid entitlement value for ${key} (boolean required)` });
      }
      next[key] = v;
    }

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { entitlements: next },
    });

    // ✅ CRITICAL: bust cache so new entitlements apply immediately
    invalidateEntitlementsCache(schoolId);

    await logAudit(req, {
      action: "SETTINGS_ENTITLEMENTS_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: {
        changedKeys: Object.keys(incoming).map((k) => upper(k)),
      },
    });

    return res.json({ ok: true, subscription: updated });
  } catch (err) {
    console.error("SUBSCRIPTION ENTITLEMENTS PATCH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
