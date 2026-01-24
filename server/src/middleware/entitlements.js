// src/middleware/entitlements.js
import { prisma } from "../lib/prisma.js";

// Tiny in-memory cache (best effort). Prevents DB spam on every request.
// Safe because entitlements don’t change often.
const CACHE_TTL_MS = 30_000;
const subCache = new Map(); // schoolId -> { exp: number, sub: { status, entitlements } }

function getCachedSub(schoolId) {
  const hit = subCache.get(schoolId);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    subCache.delete(schoolId);
    return null;
  }
  return hit.sub;
}

function setCachedSub(schoolId, sub) {
  subCache.set(schoolId, { exp: Date.now() + CACHE_TTL_MS, sub });
}

/**
 * HYBRID POLICY (C)
 * - ADMIN can always READ core academic modules (no entitlement lock).
 * - Subscription still controls premium/non-core features.
 * - WRITE still requires entitlement (and your requireRole gates still apply).
 *
 * Add/remove keys as your product policy evolves.
 */
const ADMIN_CORE_READ = new Set([
  "EXAMS_READ",
  // future-proof (enable when you introduce these keys)
  // "RESULTS_READ",
  // "STUDENTS_READ",
  // "CLASSES_READ",
  // "ATTENDANCE_READ",
]);

export function requireEntitlement(key) {
  return async (req, res, next) => {
    try {
      // ✅ Use tenant-resolved schoolId first (source of truth)
      const schoolId = req.schoolId || req.user?.schoolId || req.user?.tenantId || null;

      // SYSTEM_ADMIN in platform mode might have no tenant.
      // Those endpoints should not require tenant entitlements unless explicitly scoped.
      if (!schoolId) {
        return res.status(403).json({
          message: "Tenant required for this action (no school context selected)",
        });
      }

      const role = req.role || req.user?.role || null;
      const isRead = key.endsWith("_READ");

      // ✅ HYBRID OVERRIDE: ADMIN can always READ core keys (no entitlement lock)
      if (role === "ADMIN" && isRead && ADMIN_CORE_READ.has(key)) {
        return next();
      }

      // Cached subscription
      let sub = getCachedSub(schoolId);

      if (sub === undefined) sub = null; // just in case (not required)

      if (!sub) {
        sub = await prisma.subscription.findFirst({
          where: { schoolId },
          orderBy: { createdAt: "desc" },
          select: { status: true, entitlements: true },
        });

        // Cache even null to avoid repeated lookups (short TTL)
        setCachedSub(schoolId, sub || null);
      }

      if (!sub) {
        return res.status(403).json({
          message: `Feature locked: missing entitlement ${key}`,
        });
      }

      const ent = sub.entitlements || {};

      // ✅ Trial experience: READ allowed by default
      if (sub.status === "TRIAL" && isRead) return next();

      const allowed = Boolean(ent?.[key]);
      if (!allowed) {
        return res.status(403).json({
          message: `Feature locked: missing entitlement ${key}`,
        });
      }

      return next();
    } catch (e) {
      console.error("ENTITLEMENT ERROR:", e);
      return res.status(500).json({ message: "Entitlement check failed" });
    }
  };
}
