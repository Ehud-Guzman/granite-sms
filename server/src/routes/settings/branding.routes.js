// src/routes/settings/branding.routes.js
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import crypto from "crypto";
import { fileURLToPath } from "url";

import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { clearSettingsCache } from "../../middleware/features.js";
import { logAudit, actorCtx } from "../../utils/audit.js";

const router = Router();

/**
 * ✅ Stable server root from THIS file location
 * file: src/routes/settings/branding.routes.js
 * __dirname = .../src/routes/settings
 * project root is 4 levels up: settings -> routes -> src -> (project root)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ FIX: go up 4 levels to project root (where server.js is)
const SERVER_ROOT = path.join(__dirname, "..", "..", "..", "..");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toDiskPathFromPublicUrl(publicUrl) {
  // publicUrl like "/uploads/branding/xxx.png"
  if (!publicUrl) return null;

  const clean = String(publicUrl).replace(/^\/+/, ""); // remove leading slash

  // ✅ Only allow deleting inside /uploads/branding (avoid accidental deletes)
  if (!clean.startsWith("uploads/branding/")) return null;

  return path.join(SERVER_ROOT, clean);
}

async function getOrCreateSettings(schoolId) {
  let settings = await prisma.schoolSettings.findUnique({ where: { schoolId } });
  if (!settings) settings = await prisma.schoolSettings.create({ data: { schoolId } });
  return settings;
}

// ---------- validation helpers ----------
const THEME_KEYS = new Set(["royal-blue", "emerald", "maroon", "amber", "slate"]);
const MODES = new Set(["light", "dark"]);
const DENSITIES = new Set(["normal", "compact", "comfortable"]);
const RADII = new Set(["sharp", "rounded", "pill"]);

const isHex = (v) =>
  v == null || (typeof v === "string" && /^#([0-9a-fA-F]{6})$/.test(v.trim()));

const isStringOrNull = (v) => v == null || typeof v === "string";

function normalizeThemeValue(set, v, fieldName) {
  if (v == null) return null; // allow clearing
  const s = String(v).trim();
  if (!set.has(s)) throw new Error(`${fieldName} is invalid`);
  return s;
}

function brandingPayload(body) {
  const b = body || {};

  // ✅ allowlist (prevents unknown-field 400)
  const allowed = new Set([
    "brandPrimaryColor",
    "brandSecondaryColor",
    "themeKey",
    "mode",
    "density",
    "radius",
  ]);

  for (const k of Object.keys(b)) {
    if (!allowed.has(k)) {
      const err = new Error(`Unknown field: ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }

  // ✅ validate & normalize
  if ("brandPrimaryColor" in b && !isHex(b.brandPrimaryColor)) {
    const err = new Error("brandPrimaryColor must be hex (#1f2937)");
    err.statusCode = 400;
    throw err;
  }
  if ("brandSecondaryColor" in b && !isHex(b.brandSecondaryColor)) {
    const err = new Error("brandSecondaryColor must be hex (#2563eb)");
    err.statusCode = 400;
    throw err;
  }

  if ("themeKey" in b && !isStringOrNull(b.themeKey)) {
    const err = new Error("themeKey must be a string or null");
    err.statusCode = 400;
    throw err;
  }
  if ("mode" in b && !isStringOrNull(b.mode)) {
    const err = new Error("mode must be a string or null");
    err.statusCode = 400;
    throw err;
  }
  if ("density" in b && !isStringOrNull(b.density)) {
    const err = new Error("density must be a string or null");
    err.statusCode = 400;
    throw err;
  }
  if ("radius" in b && !isStringOrNull(b.radius)) {
    const err = new Error("radius must be a string or null");
    err.statusCode = 400;
    throw err;
  }

  const data = {};

  if ("brandPrimaryColor" in b) data.brandPrimaryColor = b.brandPrimaryColor || null;
  if ("brandSecondaryColor" in b) data.brandSecondaryColor = b.brandSecondaryColor || null;

  if ("themeKey" in b) data.themeKey = normalizeThemeValue(THEME_KEYS, b.themeKey, "themeKey");
  if ("mode" in b) data.mode = normalizeThemeValue(MODES, b.mode, "mode");
  if ("density" in b) data.density = normalizeThemeValue(DENSITIES, b.density, "density");
  if ("radius" in b) data.radius = normalizeThemeValue(RADII, b.radius, "radius");

  return data;
}

function brandingResponse(schoolId, s) {
  return {
    branding: {
      schoolId,
      brandLogoUrl: s.brandLogoUrl,
      brandPrimaryColor: s.brandPrimaryColor,
      brandSecondaryColor: s.brandSecondaryColor,

      themeKey: s.themeKey || null,
      mode: s.mode || null,
      density: s.density || null,
      radius: s.radius || null,

      updatedAt: s.updatedAt,
    },
  };
}

// ---------- multer ----------

// Held in memory, checked, then stored in the database (SchoolLogo).
const storage = multer.memoryStorage();

/**
 * The real type from the file's first bytes. The browser's MIME type is
 * only a claim (audit L7), so it isn't trusted on its own.
 */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

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
      // Learners and parents see the school's name, logo and colours too.
      allowRoles: ["SYSTEM_ADMIN", "ADMIN", "TEACHER", "BURSAR", "STUDENT", "PARENT"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    const { schoolId } = resolved;
    const s = await getOrCreateSettings(schoolId);

    return res.json(brandingResponse(schoolId, s));
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

    // ✅ validate + normalize payload
    let data;
    try {
      data = brandingPayload(req.body || {});
    } catch (e) {
      const code = e.statusCode || 400;
      return res.status(code).json({ message: e.message || "Bad Request" });
    }

    if (Object.keys(data).length === 0) {
      const s = await getOrCreateSettings(schoolId);
      return res.json(brandingResponse(schoolId, s));
    }

    const s = await getOrCreateSettings(schoolId);

    const updated = await prisma.schoolSettings.update({
      where: { id: s.id },
      data,
    });

    clearSettingsCache();

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "BRANDING_UPDATED",
      targetType: "SCHOOL_SETTINGS",
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(req.body || {}) },
    });

    return res.json(brandingResponse(schoolId, updated));
  } catch (err) {
    console.error("PATCH BRANDING ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ POST /api/settings/branding/logo
// Restrict uploads to ADMIN/SYSTEM_ADMIN only.
// Single handler: authorize FIRST, then run multer, then persist.
function authorizeLogoUpload(req, res, next) {
  try {
    const resolved = resolveSchoolScope(req, {
      allowPlatform: false,
      allowRoles: ["SYSTEM_ADMIN", "ADMIN"],
    });
    if (!resolved.ok) return res.status(resolved.code).json({ message: resolved.message });

    // Stash the resolved scope so the final handler doesn't recompute it.
    req.brandingScope = resolved;

    // Only touch multer (which writes to disk) after authorization passes.
    return upload.single("logo")(req, res, (err) => {
      if (err) return res.status(400).json({ message: err?.message || "Upload failed" });
      return next();
    });
  } catch (err) {
    console.error("AUTH UPLOAD LOGO ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

router.post("/logo", requireAuth, authorizeLogoUpload, async (req, res) => {
  try {
    const resolved = req.brandingScope;
    if (!resolved?.ok) return res.status(403).json({ message: "Forbidden" });

    const { schoolId } = resolved;
    if (!req.file) return res.status(400).json({ message: "No logo uploaded" });

    const mime = sniffImageType(req.file.buffer);
    if (!mime) return res.status(400).json({ message: "That file is not a PNG, JPG or WEBP image." });

    const s = await getOrCreateSettings(schoolId);

    // A logo from before logos were stored in the database: remove the file.
    if (s.brandLogoUrl?.startsWith("/uploads/branding/")) {
      const oldPath = toDiskPathFromPublicUrl(s.brandLogoUrl);
      try {
        if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch {}
    }

    const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    await prisma.schoolLogo.upsert({
      where: { schoolId },
      create: { schoolId, mime, data: req.file.buffer, size: req.file.size, sha256 },
      update: { mime, data: req.file.buffer, size: req.file.size, sha256 },
    });
    // The version in the path changes with the image, so it can be cached forever.
    const url = `/api/public/schools/${encodeURIComponent(schoolId)}/logo/${sha256.slice(0, 16)}`;

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

    return res.status(201).json(brandingResponse(schoolId, updated));
  } catch (err) {
    console.error("UPLOAD LOGO ERROR:", err);
    return res.status(400).json({ message: err?.message || "Upload failed" });
  }
});

export default router;
