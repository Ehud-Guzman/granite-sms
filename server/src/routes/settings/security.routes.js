// src/routes/settings/security.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { upper, isValidSchoolId } from "../../utils/roleScope.js";

const router = Router();

// GET /api/settings/security
router.get("/", requireAuth, async (req, res) => {
  try {
    const role = upper(req.role);
    if (!["SYSTEM_ADMIN", "ADMIN"].includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({
      lockout: {
        enabled: true,
        maxAttempts: 5,
        lockMinutes: 30,
        fields: ["failedLoginAttempts", "lockUntil", "lastLoginAt"],
      },
      auditLogs: { enabled: true },
      notes: "Phase 1 security is enforced server-side; UI policy customization comes later.",
    });
  } catch (err) {
    console.error("SECURITY SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/settings/security/overview
router.get("/overview", requireAuth, async (req, res) => {
  try {
    const role = upper(req.role);
    if (!["SYSTEM_ADMIN", "ADMIN"].includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const whereScope = {};

    if (role === "ADMIN") {
      if (!req.schoolId) return res.status(400).json({ message: "Tenant required" });
      whereScope.schoolId = req.schoolId;
    } else {
      const qSchoolId = req.query?.schoolId ? String(req.query.schoolId).trim() : null;
      if (qSchoolId) {
        if (!isValidSchoolId(qSchoolId)) return res.status(400).json({ message: "Invalid schoolId" });
        whereScope.schoolId = qSchoolId;
      }
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const lastEvent = await prisma.auditLog.findFirst({
      where: whereScope,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, action: true },
    });

    const today = {
      loginSuccess: await prisma.auditLog.count({
        where: { ...whereScope, action: "LOGIN_SUCCESS", createdAt: { gte: startOfDay } },
      }),
      loginFailed: await prisma.auditLog.count({
        where: { ...whereScope, action: "LOGIN_FAILED", createdAt: { gte: startOfDay } },
      }),
      accountLocked: await prisma.auditLog.count({
        where: { ...whereScope, action: "ACCOUNT_LOCKED", createdAt: { gte: startOfDay } },
      }),
      loginBlockedLocked: await prisma.auditLog.count({
        where: { ...whereScope, action: "LOGIN_BLOCKED_LOCKED", createdAt: { gte: startOfDay } },
      }),
      loginBlockedNoTenant: await prisma.auditLog.count({
        where: { ...whereScope, action: "LOGIN_BLOCKED_NO_TENANT", createdAt: { gte: startOfDay } },
      }),
    };

    // Proxy metric: locks created within last 24h
    const activeLocksProxy = await prisma.auditLog.count({
      where: { ...whereScope, action: "ACCOUNT_LOCKED", createdAt: { gte: last24h } },
    });

    // Top actions last 24h (no groupBy dependency)
    const recent = await prisma.auditLog.findMany({
      where: { ...whereScope, createdAt: { gte: last24h } },
      select: { action: true },
      take: 5000,
      orderBy: { createdAt: "desc" },
    });

    const map = {};
    for (const r of recent) map[r.action] = (map[r.action] || 0) + 1;

    const last24hTopActions = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([action, count]) => ({ action, count }));

    return res.json({
      scope: whereScope.schoolId ? { schoolId: whereScope.schoolId } : { platform: true },
      lastEventAt: lastEvent?.createdAt || null,
      lastEventAction: lastEvent?.action || null,
      today,
      activeLocksProxy,
      last24hTopActions,
    });
  } catch (err) {
    console.error("SECURITY OVERVIEW ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
