// src/routes/settings/academics.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

const ALLOWED_KEYS = ["currentAcademicYear", "term1Label", "term2Label", "term3Label"];

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

function isNullableString(v, max = 80) {
  if (v === null) return true;
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}
function isYearLike(v) {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return /^(\d{4})(\/\d{4})?$/.test(s);
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;

    let settings = await prisma.schoolSettings.findUnique({
      where: { schoolId },
      select: {
        id: true,
        schoolId: true,
        currentAcademicYear: true,
        term1Label: true,
        term2Label: true,
        term3Label: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!settings) {
      settings = await prisma.schoolSettings.create({
        data: {
          schoolId,
          currentAcademicYear: null,
          term1Label: "Term 1",
          term2Label: "Term 2",
          term3Label: "Term 3",
        },
        select: {
          id: true,
          schoolId: true,
          currentAcademicYear: true,
          term1Label: true,
          term2Label: true,
          term3Label: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return res.json({ academics: settings });
  } catch (err) {
    console.error("GET ACADEMICS SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;

    const body = req.body || {};

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ message: `Unknown field: ${key}` });
      }
    }

    if ("currentAcademicYear" in body) {
      if (!isNullableString(body.currentAcademicYear, 20) || !isYearLike(body.currentAcademicYear)) {
        return res
          .status(400)
          .json({ message: "currentAcademicYear must be like '2026' or '2025/2026' or null" });
      }
    }

    for (const k of ["term1Label", "term2Label", "term3Label"]) {
      if (k in body && !isNullableString(body[k], 40)) {
        return res.status(400).json({ message: `${k} must be string or null (max 40 chars)` });
      }
    }

    let existing = await prisma.schoolSettings.findUnique({
      where: { schoolId },
      select: { id: true },
    });

    if (!existing) {
      existing = await prisma.schoolSettings.create({
        data: {
          schoolId,
          currentAcademicYear: null,
          term1Label: "Term 1",
          term2Label: "Term 2",
          term3Label: "Term 3",
        },
        select: { id: true },
      });
    }

    const data = {};
    if ("currentAcademicYear" in body)
      data.currentAcademicYear =
        body.currentAcademicYear === null ? null : String(body.currentAcademicYear).trim();
    if ("term1Label" in body) data.term1Label = body.term1Label === null ? null : String(body.term1Label).trim();
    if ("term2Label" in body) data.term2Label = body.term2Label === null ? null : String(body.term2Label).trim();
    if ("term3Label" in body) data.term3Label = body.term3Label === null ? null : String(body.term3Label).trim();

    const updated = await prisma.schoolSettings.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        schoolId: true,
        currentAcademicYear: true,
        term1Label: true,
        term2Label: true,
        term3Label: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "ACADEMICS_SETTINGS_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(body) },
    });

    return res.json({ academics: updated });
  } catch (err) {
    console.error("PATCH ACADEMICS SETTINGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
