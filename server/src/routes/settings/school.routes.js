// src/routes/settings/school.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

const ALLOWED_KEYS = ["name", "shortName", "code", "contactEmail", "contactPhone"];

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

function isNonEmptyString(v, max = 200) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}
function isNullableString(v, max = 200) {
  return v === null || isNonEmptyString(v, max);
}
function isEmailLike(v) {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// GET /api/settings/school  (ADMIN: tenant header, SYSTEM_ADMIN: ?schoolId=)
router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, { allowPlatform: false });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        shortName: true,
        code: true,
        contactEmail: true,
        contactPhone: true,
        createdAt: true,
      },
    });

    if (!school) return res.status(404).json({ message: "School not found" });

    return res.json({ school });
  } catch (err) {
    console.error("GET SCHOOL PROFILE ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/settings/school
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

    if ("name" in body && !isNonEmptyString(body.name, 140)) {
      return res.status(400).json({ message: "name is required (max 140 chars)" });
    }
    if ("shortName" in body && !isNullableString(body.shortName, 50)) {
      return res.status(400).json({ message: "shortName must be string or null (max 50 chars)" });
    }
    if ("code" in body && !isNullableString(body.code, 50)) {
      return res.status(400).json({ message: "code must be string or null (max 50 chars)" });
    }
    if ("contactEmail" in body) {
      if (!isNullableString(body.contactEmail, 120) || !isEmailLike(body.contactEmail)) {
        return res.status(400).json({ message: "contactEmail must be a valid email or null" });
      }
    }
    if ("contactPhone" in body && !isNullableString(body.contactPhone, 40)) {
      return res.status(400).json({ message: "contactPhone must be string or null (max 40 chars)" });
    }

    const data = {};
    if ("name" in body) data.name = String(body.name).trim();
    if ("shortName" in body) data.shortName = body.shortName === null ? null : String(body.shortName).trim();
    if ("code" in body) data.code = body.code === null ? null : String(body.code).trim();
    if ("contactEmail" in body)
      data.contactEmail =
        body.contactEmail === null ? null : String(body.contactEmail).trim().toLowerCase();
    if ("contactPhone" in body)
      data.contactPhone = body.contactPhone === null ? null : String(body.contactPhone).trim();

    const updated = await prisma.school.update({
      where: { id: schoolId },
      data,
      select: {
        id: true,
        name: true,
        shortName: true,
        code: true,
        contactEmail: true,
        contactPhone: true,
        createdAt: true,
      },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "SCHOOL_PROFILE_UPDATED",
      targetType: "SCHOOL",
      targetId: schoolId,
      metadata: { updatedFields: Object.keys(body) },
    });

    return res.json({ school: updated });
  } catch (err) {
    console.error("PATCH SCHOOL PROFILE ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
