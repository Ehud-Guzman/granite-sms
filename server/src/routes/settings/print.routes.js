import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

async function getOrCreateSettings(schoolId) {
  let settings = await prisma.schoolSettings.findUnique({ where: { schoolId } });
  if (!settings) {
    settings = await prisma.schoolSettings.create({ data: { schoolId } });
  }
  return settings;
}

function cleanText(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) return s.slice(0, max);
  return s;
}

// ✅ GET /api/settings/print
// Allow TEACHER/BURSAR to READ print settings for printing (letterhead/footer)
router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN", "TEACHER", "BURSAR"],
    });
    if (!resolved.ok)
      return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const s = await getOrCreateSettings(schoolId);

    return res.json({
      print: {
        schoolId,
        printShowLogo: s.printShowLogo,
        printHeaderText: s.printHeaderText,
        printFooterText: s.printFooterText,
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    console.error("GET PRINT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ PATCH /api/settings/print
// Restrict updates to ADMIN/SYSTEM_ADMIN only
router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok)
      return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const body = req.body || {};

    const allowed = ["printShowLogo", "printHeaderText", "printFooterText"];
    for (const k of Object.keys(body)) {
      if (!allowed.includes(k))
        return res.status(400).json({ message: `Unknown field: ${k}` });
    }

    if ("printShowLogo" in body && typeof body.printShowLogo !== "boolean") {
      return res.status(400).json({ message: "printShowLogo must be boolean" });
    }

    const s = await getOrCreateSettings(schoolId);

    const data = {};
    if ("printShowLogo" in body) data.printShowLogo = body.printShowLogo;
    if ("printHeaderText" in body)
      data.printHeaderText = cleanText(body.printHeaderText, 800);
    if ("printFooterText" in body)
      data.printFooterText = cleanText(body.printFooterText, 800);

    const updated = await prisma.schoolSettings.update({
      where: { id: s.id },
      data,
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "PRINT_SETTINGS_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(data) },
    });

    return res.json({
      print: {
        schoolId,
        printShowLogo: updated.printShowLogo,
        printHeaderText: updated.printHeaderText,
        printFooterText: updated.printFooterText,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error("PATCH PRINT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
