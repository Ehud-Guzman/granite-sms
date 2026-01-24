// src/routes/settings/features.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

const FLAG_KEYS = ["enableClassTeachers", "enableSubjectAssignments"];

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

// GET /api/settings (ADMIN)
router.get("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    if (!req.schoolId) return res.status(400).json({ message: "Tenant required" });

    let settings = await prisma.schoolSettings.findUnique({
      where: { schoolId: req.schoolId },
    });

    if (!settings) {
      settings = await prisma.schoolSettings.create({
        data: { schoolId: req.schoolId },
      });
    }

    return res.json(settings);
  } catch (err) {
    console.error("GET SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/settings (ADMIN)
router.patch("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    if (!req.schoolId) return res.status(400).json({ message: "Tenant required" });

    const body = req.body || {};

    // reject unknown keys
    for (const key of Object.keys(body)) {
      if (!FLAG_KEYS.includes(key)) {
        return res.status(400).json({ message: `Unknown field: ${key}` });
      }
    }

    // type validation
    if ("enableClassTeachers" in body && typeof body.enableClassTeachers !== "boolean") {
      return res.status(400).json({ message: "enableClassTeachers must be boolean" });
    }
    if ("enableSubjectAssignments" in body && typeof body.enableSubjectAssignments !== "boolean") {
      return res.status(400).json({ message: "enableSubjectAssignments must be boolean" });
    }

    let settings = await prisma.schoolSettings.findUnique({
      where: { schoolId: req.schoolId },
    });

    if (!settings) {
      settings = await prisma.schoolSettings.create({
        data: { schoolId: req.schoolId },
      });
    }

    const updated = await prisma.schoolSettings.update({
      where: { id: settings.id },
      data: {
        ...("enableClassTeachers" in body ? { enableClassTeachers: body.enableClassTeachers } : {}),
        ...("enableSubjectAssignments" in body
          ? { enableSubjectAssignments: body.enableSubjectAssignments }
          : {}),
      },
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId: req.schoolId,
      action: "SETTINGS_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(body) },
    });

    return res.json(updated);
  } catch (err) {
    console.error("PATCH SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
