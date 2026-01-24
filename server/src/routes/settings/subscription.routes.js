// src/routes/settings/subscription.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope, upper } from "../../utils/roleScope.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

// ✅ Must match Prisma enum in schema.prisma
// SubscriptionStatus = TRIAL | ACTIVE | PAST_DUE | CANCELED | EXPIRED
const ALLOWED_STATUS = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];

// JSON limit keys (preferred)
const LIMIT_KEYS = ["STUDENTS_MAX", "TEACHERS_MAX", "CLASSES_MAX"];

// Which statuses allow writes (business policy)
const WRITE_ENABLED_STATUS = new Set(["TRIAL", "ACTIVE"]);

function toUpperStr(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? upper(s) : null;
}

function parseISODateOrNull(v) {
  // allowed:
  // - null => clear
  // - ""   => clear
  // - ISO string => Date
  // invalid => undefined
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseCapValue(v) {
  // allowed:
  // - null => unlimited
  // - number >= 0
  // invalid => undefined
  if (v === null) return null;
  if (v === "" || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function capFromLimitsJson(limits, key) {
  if (!limits || typeof limits !== "object") return undefined;
  const v = limits[key];
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function assertSystemAdmin(role) {
  return upper(role) === "SYSTEM_ADMIN";
}

async function getLatestSubscription(schoolId) {
  return prisma.subscription.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      planCode: true,
      status: true,
      maxStudents: true,
      maxTeachers: true,
      maxClasses: true,
      currentPeriodEnd: true,
      entitlements: true,
      limits: true,
      createdAt: true,
    },
  });
}

async function ensureSubscriptionRow(schoolId) {
  const latest = await getLatestSubscription(schoolId);
  if (latest) return latest;

  // ✅ Consistent safe defaults
  return prisma.subscription.create({
    data: {
      schoolId,
      planCode: "FREE",
      status: "TRIAL",
      maxStudents: 50,
      maxTeachers: 10,
      maxClasses: 5,
      currentPeriodEnd: null,
      entitlements: {},
      limits: null,
    },
    select: {
      id: true,
      planCode: true,
      status: true,
      maxStudents: true,
      maxTeachers: true,
      maxClasses: true,
      currentPeriodEnd: true,
      entitlements: true,
      limits: true,
      createdAt: true,
    },
  });
}

// -----------------------------
// GET /api/settings/subscription/overview
// -----------------------------
router.get("/overview", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { role, schoolId } = resolved;

    // ✅ Always ensure row exists so the frontend has stable shape
    const sub = await ensureSubscriptionRow(schoolId);

    // Effective caps (match middleware behavior)
    const capStudents = capFromLimitsJson(sub.limits, "STUDENTS_MAX");
    const capTeachers = capFromLimitsJson(sub.limits, "TEACHERS_MAX");
    const capClasses = capFromLimitsJson(sub.limits, "CLASSES_MAX");

    const maxStudents = capStudents !== undefined ? capStudents : sub.maxStudents;
    const maxTeachers = capTeachers !== undefined ? capTeachers : sub.maxTeachers;
    const maxClasses = capClasses !== undefined ? capClasses : sub.maxClasses;

    // Align with enforcement:
    // - students: active only
    // - classes: active only
    // - teachers: total
    const [studentsCount, teachersCount, classesCount] = await Promise.all([
      prisma.student.count({ where: { schoolId, isActive: true } }),
      prisma.teacher.count({ where: { schoolId } }),
      prisma.class.count({ where: { schoolId, isActive: true } }),
    ]);

    const remaining = {
      studentsRemaining: maxStudents == null ? null : Math.max(Number(maxStudents) - studentsCount, 0),
      teachersRemaining: maxTeachers == null ? null : Math.max(Number(maxTeachers) - teachersCount, 0),
      classesRemaining: maxClasses == null ? null : Math.max(Number(maxClasses) - classesCount, 0),
    };

    const now = new Date();
    const isExpired = sub.currentPeriodEnd ? now > new Date(sub.currentPeriodEnd) : false;
    const normalizedStatus = upper(sub.status);

    // ✅ Write policy
    const canWrite = WRITE_ENABLED_STATUS.has(normalizedStatus) && !isExpired;

    return res.json({
      scope: role,
      schoolId,
      subscription: {
        planCode: sub.planCode,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        entitlements: sub.entitlements || {},
        limits: sub.limits || null,
        // Keep legacy caps too for UI compatibility
        maxStudents,
        maxTeachers,
        maxClasses,
      },
      usage: { studentsCount, teachersCount, classesCount },
      remaining,
      flags: { isExpired, canWrite },
    });
  } catch (err) {
    console.error("SUBSCRIPTION OVERVIEW ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// PATCH /api/settings/subscription
// SYSTEM_ADMIN only
// body: { planCode?, status?, currentPeriodEnd? }
// -----------------------------
router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { role, schoolId } = resolved;
    if (!assertSystemAdmin(role)) return res.status(403).json({ message: "Forbidden" });

    const latest = await ensureSubscriptionRow(schoolId);

    const planCode = toUpperStr(req.body?.planCode);
    const status = toUpperStr(req.body?.status);
    const currentPeriodEnd = parseISODateOrNull(req.body?.currentPeriodEnd);

    if (planCode && planCode.length > 32) {
      return res.status(400).json({ message: "Invalid planCode" });
    }

    if (status && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${ALLOWED_STATUS.join(", ")}`,
      });
    }

    if (currentPeriodEnd === undefined) {
      return res.status(400).json({ message: "Invalid currentPeriodEnd (must be ISO date or null)" });
    }

    const nextData = {
      ...(planCode ? { planCode } : {}),
      ...(status ? { status } : {}),
      ...(req.body?.currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
    };

    if (Object.keys(nextData).length === 0) {
      return res.status(400).json({ message: "No changes provided" });
    }

    const updated = await prisma.subscription.update({
      where: { id: latest.id },
      data: nextData,
      select: {
        id: true,
        planCode: true,
        status: true,
        currentPeriodEnd: true,
        entitlements: true,
        limits: true,
        maxStudents: true,
        maxTeachers: true,
        maxClasses: true,
      },
    });

    await logAudit(req, {
      action: "SETTINGS_SUBSCRIPTION_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: {
        schoolId,
        before: {
          planCode: latest.planCode,
          status: latest.status,
          currentPeriodEnd: latest.currentPeriodEnd,
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
// body: { limits: { STUDENTS_MAX?, TEACHERS_MAX?, CLASSES_MAX? } }
// values: number >= 0 | null
// -----------------------------
router.patch("/limits", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { role, schoolId } = resolved;
    if (!assertSystemAdmin(role)) return res.status(403).json({ message: "Forbidden" });

    const latest = await ensureSubscriptionRow(schoolId);

    const incoming = req.body?.limits;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "limits must be an object" });
    }

    const prevLimits = latest.limits && typeof latest.limits === "object" ? latest.limits : {};
    const nextLimits = { ...prevLimits };

    for (const k of Object.keys(incoming)) {
      const key = upper(k);
      if (!LIMIT_KEYS.includes(key)) continue;

      const parsed = parseCapValue(incoming[k]);
      if (parsed === undefined) {
        return res.status(400).json({ message: `Invalid limit value for ${key} (number>=0 or null)` });
      }
      nextLimits[key] = parsed;
    }

    const updated = await prisma.subscription.update({
      where: { id: latest.id },
      data: { limits: nextLimits },
      select: {
        id: true,
        planCode: true,
        status: true,
        currentPeriodEnd: true,
        entitlements: true,
        limits: true,
        maxStudents: true,
        maxTeachers: true,
        maxClasses: true,
      },
    });

    await logAudit(req, {
      action: "SETTINGS_LIMITS_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: {
        schoolId,
        before: prevLimits,
        after: nextLimits,
      },
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
// body: { entitlements: { SOME_KEY: true/false } }
// -----------------------------
router.patch("/entitlements", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { role, schoolId } = resolved;
    if (!assertSystemAdmin(role)) return res.status(403).json({ message: "Forbidden" });

    const latest = await ensureSubscriptionRow(schoolId);

    const incoming = req.body?.entitlements;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "entitlements must be an object" });
    }

    const prevEnt = latest.entitlements && typeof latest.entitlements === "object" ? latest.entitlements : {};
    const nextEnt = { ...prevEnt };

    for (const [k, v] of Object.entries(incoming)) {
      const key = upper(String(k || "").trim());
      if (!key || !/^[A-Z0-9_]{3,64}$/.test(key)) continue;

      if (typeof v !== "boolean") {
        return res.status(400).json({ message: `Invalid entitlement value for ${key} (must be boolean)` });
      }
      nextEnt[key] = v;
    }

    const updated = await prisma.subscription.update({
      where: { id: latest.id },
      data: { entitlements: nextEnt },
      select: {
        id: true,
        planCode: true,
        status: true,
        currentPeriodEnd: true,
        entitlements: true,
        limits: true,
        maxStudents: true,
        maxTeachers: true,
        maxClasses: true,
      },
    });

    await logAudit(req, {
      action: "SETTINGS_ENTITLEMENTS_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: {
        schoolId,
        changedKeys: Object.keys(incoming).map((k) => upper(String(k))),
      },
    });

    return res.json({ ok: true, subscription: updated });
  } catch (err) {
    console.error("SUBSCRIPTION ENTITLEMENTS PATCH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
