import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";

import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit } from "../../utils/audit.js";

const router = Router();

/** ✅ Stable server root from THIS file location
 * file: src/routes/settings/branding.routes.js
 * go up: settings -> routes -> src -> server(root)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..", "..", "..");

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toDiskPathFromPublicUrl(publicUrl) {
  // publicUrl like "/uploads/branding/xxx.png"
  if (!publicUrl) return null;
  const clean = String(publicUrl).replace(/^\/+/, ""); // remove leading slash
  return path.join(SERVER_ROOT, clean);
}

async function getOrCreateSettings(schoolId) {
  let settings = await prisma.schoolSettings.findUnique({ where: { schoolId } });
  if (!settings) settings = await prisma.schoolSettings.create({ data: { schoolId } });
  return settings;
}

// ---------- multer ----------
const uploadDir = path.join(SERVER_ROOT, "uploads", "branding");
ensureDir(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";

    const schoolId = String(req.query?.schoolId || req.schoolId || "school").replace(
      /[^a-zA-Z0-9_-]/g,
      ""
    );

    cb(null, `logo_${schoolId}_${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only PNG, JPG, WEBP allowed"), ok);
  },
});

// ---------- routes ----------

// ✅ GET /api/settings/branding
// Allow TEACHER/BURSAR to READ branding for printing (letterhead)
router.get("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN", "TEACHER", "BURSAR"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const s = await getOrCreateSettings(schoolId);

    return res.json({
      branding: {
        schoolId,
        brandLogoUrl: s.brandLogoUrl,
        brandPrimaryColor: s.brandPrimaryColor,
        brandSecondaryColor: s.brandSecondaryColor,
        updatedAt: s.updatedAt,
      },
    });
  } catch (err) {
    console.error("GET BRANDING ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ PATCH /api/settings/branding
// Restrict updates to ADMIN/SYSTEM_ADMIN only
router.patch("/", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const body = req.body || {};

    const allowed = ["brandPrimaryColor", "brandSecondaryColor"];
    for (const k of Object.keys(body)) {
      if (!allowed.includes(k))
        return res.status(400).json({ message: `Unknown field: ${k}` });
    }

    const hexOk = (v) =>
      v == null || (typeof v === "string" && /^#([0-9a-fA-F]{6})$/.test(v.trim()));

    if ("brandPrimaryColor" in body && !hexOk(body.brandPrimaryColor)) {
      return res.status(400).json({ message: "brandPrimaryColor must be hex (#1f2937)" });
    }
    if ("brandSecondaryColor" in body && !hexOk(body.brandSecondaryColor)) {
      return res.status(400).json({ message: "brandSecondaryColor must be hex (#2563eb)" });
    }

    const s = await getOrCreateSettings(schoolId);

    const updated = await prisma.schoolSettings.update({
      where: { id: s.id },
      data: {
        ...("brandPrimaryColor" in body
          ? { brandPrimaryColor: body.brandPrimaryColor || null }
          : {}),
        ...("brandSecondaryColor" in body
          ? { brandSecondaryColor: body.brandSecondaryColor || null }
          : {}),
      },
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "BRANDING_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(body) },
    });

    return res.json({
      branding: {
        schoolId,
        brandLogoUrl: updated.brandLogoUrl,
        brandPrimaryColor: updated.brandPrimaryColor,
        brandSecondaryColor: updated.brandSecondaryColor,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error("PATCH BRANDING ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ POST /api/settings/branding/logo
// Restrict uploads to ADMIN/SYSTEM_ADMIN only
router.post("/logo", requireAuth, async (req, res, next) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    // pass control to multer ONLY if authorized
    return upload.single("logo")(req, res, (err) => {
      if (err) return res.status(400).json({ message: err?.message || "Upload failed" });
      return next();
    });
  } catch (err) {
    console.error("AUTH UPLOAD LOGO ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/logo", requireAuth, async (req, res) => {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    if (!req.file) return res.status(400).json({ message: "No logo uploaded" });

    const s = await getOrCreateSettings(schoolId);

    // ✅ safe cleanup of old logo
    if (s.brandLogoUrl?.startsWith("/uploads/branding/")) {
      const oldPath = toDiskPathFromPublicUrl(s.brandLogoUrl);
      try {
        if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch {}
    }

    const url = `/uploads/branding/${req.file.filename}`;

    const updated = await prisma.schoolSettings.update({
      where: { id: s.id },
      data: { brandLogoUrl: url },
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "BRAND_LOGO_UPLOADED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { brandLogoUrl: url },
    });

    return res.status(201).json({
      branding: {
        schoolId,
        brandLogoUrl: updated.brandLogoUrl,
        brandPrimaryColor: updated.brandPrimaryColor,
        brandSecondaryColor: updated.brandSecondaryColor,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error("UPLOAD LOGO ERROR:", err);
    return res.status(400).json({ message: err?.message || "Upload failed" });
  }
});

export default router;
