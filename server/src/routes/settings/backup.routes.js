// src/routes/settings/backup.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { logAudit } from "../../utils/audit.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import {
  createSchoolBackup,
  listBackups,
  getBackup,
  restoreBackup,
} from "../../services/backup.service.js";

const router = Router();

const isProd = process.env.NODE_ENV === "production";

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.user?.role || null,
    actorEmail: req.user?.email || null,
  };
}

function sendError(res, code, message, debug) {
  const payload = { message: message || "Server error" };
  if (!isProd && debug) payload.debug = debug;
  return res.status(code || 500).json(payload);
}

function safeStr(v) {
  return String(v || "").trim();
}

/**
 * Enforce school scope consistently for backup endpoints.
 * - allowPlatform: false means backups are always school-scoped (recommended)
 * - resolved.schoolId will be available if ok === true
 */
function mustResolveSchoolScope(req, res, opts = { allowPlatform: false }) {
  const resolved = resolveSchoolScope(req, opts);
  if (!resolved?.ok) {
    sendError(res, resolved?.code || 400, resolved?.message || "Invalid school scope");
    return null;
  }
  return resolved;
}

/**
 * Ensure the backup being accessed belongs to the resolved school scope.
 * Prevents cross-school leakage by ID guessing.
 */
function assertBackupInScope(resolvedSchoolId, backup) {
  const backupSchoolId = backup?.schoolId || null;
  return !!resolvedSchoolId && !!backupSchoolId && resolvedSchoolId === backupSchoolId;
}

// -----------------------------
// POST /api/settings/backup/create?schoolId=...
// -----------------------------
router.post(
  "/create",
  requireAuth,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const resolved = mustResolveSchoolScope(req, res, { allowPlatform: false });
      if (!resolved) return;

      const { schoolId } = resolved;

      const out = await createSchoolBackup({
        schoolId,
        actorId: req.user?.id,
      });

      if (!out?.ok) {
        return sendError(
          res,
          out?.code || 500,
          out?.message || "Backup failed",
          out?.debug
        );
      }

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "BACKUP_CREATED",
        targetType: "BACKUP",
        targetId: out.backup.id,
        metadata: { meta: out.backup.meta },
      });

      return res.status(201).json({
        ok: true,
        backupId: out.backup.id,
        createdAt: out.backup.createdAt,
        meta: out.backup.meta,
      });
    } catch (err) {
      console.error("BACKUP CREATE ROUTE ERROR:", err);
      return sendError(res, 500, "Server error", err?.message);
    }
  }
);

// -----------------------------
// GET /api/settings/backup?schoolId=...
// -----------------------------
router.get(
  "/",
  requireAuth,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const resolved = mustResolveSchoolScope(req, res, { allowPlatform: false });
      if (!resolved) return;

      const out = await listBackups({ schoolId: resolved.schoolId });

      // listBackups should never crash; but keep it safe
      if (!out?.ok) {
        return sendError(
          res,
          out?.code || 500,
          out?.message || "Failed to list backups",
          out?.debug
        );
      }

      return res.json({ ok: true, backups: out.backups || [] });
    } catch (err) {
      console.error("LIST BACKUPS ERROR:", err);
      return sendError(res, 500, "Server error", err?.message);
    }
  }
);

// -----------------------------
// GET /api/settings/backup/:id/preview
// -----------------------------
router.get(
  "/:id/preview",
  requireAuth,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const resolved = mustResolveSchoolScope(req, res, { allowPlatform: false });
      if (!resolved) return;

      const id = safeStr(req.params.id);
      if (!id) return sendError(res, 400, "Invalid backup id");

      const out = await getBackup({ id, withPayload: false });
      if (!out?.ok) {
        return sendError(res, out?.code || 500, out?.message || "Backup not found", out?.debug);
      }

      // ✅ hard scope check
      if (!assertBackupInScope(resolved.schoolId, out.backup)) {
        return sendError(res, 403, "Backup is outside your current school scope");
      }

      return res.json({ ok: true, backup: out.backup });
    } catch (err) {
      console.error("BACKUP PREVIEW ERROR:", err);
      return sendError(res, 500, "Server error", err?.message);
    }
  }
);

// -----------------------------
// GET /api/settings/backup/:id/download
// -----------------------------
router.get(
  "/:id/download",
  requireAuth,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const resolved = mustResolveSchoolScope(req, res, { allowPlatform: false });
      if (!resolved) return;

      const id = safeStr(req.params.id);
      if (!id) return sendError(res, 400, "Invalid backup id");

      const out = await getBackup({ id, withPayload: true });
      if (!out?.ok) {
        return sendError(res, out?.code || 500, out?.message || "Backup not found", out?.debug);
      }

      // ✅ hard scope check
      if (!assertBackupInScope(resolved.schoolId, out.backup)) {
        return sendError(res, 403, "Backup is outside your current school scope");
      }

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId: out.backup.schoolId,
        action: "BACKUP_DOWNLOADED",
        targetType: "BACKUP",
        targetId: out.backup.id,
        metadata: { type: out.backup.type, status: out.backup.status },
      });

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="backup_${out.backup.schoolId}_${out.backup.id}.json"`
      );

      return res
        .status(200)
        .send(JSON.stringify({ meta: out.backup.meta, payload: out.backup.payload }, null, 2));
    } catch (err) {
      console.error("BACKUP DOWNLOAD ERROR:", err);
      return sendError(res, 500, "Server error", err?.message);
    }
  }
);

// -----------------------------
// POST /api/settings/backup/:id/restore
// Body:
//   { mode: "MERGE"|"REPLACE", confirm?: string, targetSchoolId?: string }
// Notes:
// - By default we restore into the current resolved scope schoolId.
// - targetSchoolId (if supplied) must match the resolved scope (unless you later decide to allow cross-tenant restores).
// -----------------------------
router.post(
  "/:id/restore",
  requireAuth,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const resolved = mustResolveSchoolScope(req, res, { allowPlatform: false });
      if (!resolved) return;

      const backupId = safeStr(req.params.id);
      if (!backupId) return sendError(res, 400, "Invalid backup id");

      const mode = safeStr(req.body?.mode || "MERGE").toUpperCase();
      if (!["MERGE", "REPLACE"].includes(mode)) {
        return sendError(res, 400, "mode must be MERGE or REPLACE");
      }

      const targetSchoolIdRaw = req.body?.targetSchoolId ? safeStr(req.body.targetSchoolId) : null;
      const targetSchoolId = targetSchoolIdRaw || resolved.schoolId;

      // ✅ keep it strict: if client tries to restore into a different school than scope, block it.
      if (targetSchoolId !== resolved.schoolId) {
        return sendError(res, 403, "targetSchoolId is outside your current school scope");
      }

      const confirm = req.body?.confirm ? String(req.body.confirm) : null;

      // ✅ load backup first (so we can enforce scope before restore)
      const b = await getBackup({ id: backupId, withPayload: true });
      if (!b?.ok) {
        return sendError(res, b?.code || 500, b?.message || "Backup not found", b?.debug);
      }

      if (!assertBackupInScope(resolved.schoolId, b.backup)) {
        return sendError(res, 403, "Backup is outside your current school scope");
      }

      // ✅ pass full context to service
      const out = await restoreBackup({
        backupId,
        mode,
        targetSchoolId,
        confirm,
        actorId: req.user?.id,
      });

    if (!out.ok) {
  return res.status(out.code || 500).json({
    message: out.message || "Restore failed",
    ...(process.env.NODE_ENV !== "production" ? { debug: out.debug } : {}),
  });
}


      await logAudit({
        req,
        ...actorCtx(req),
        schoolId: targetSchoolId,
        action: mode === "REPLACE" ? "BACKUP_RESTORED_REPLACE" : "BACKUP_RESTORED_MERGE",
        targetType: "BACKUP",
        targetId: backupId,
        metadata: {
          mode,
          targetSchoolId,
          createdUsers: (out.result?.createdUsers || []).map((x) => x.email),
        },
      });

      return res.json({
        ok: true,
        mode,
        targetSchoolId,
        result: out.result,
      });
    } catch (err) {
      console.error("RESTORE ROUTE ERROR:", err);
      return sendError(res, 500, "Server error", err?.message);
    }
  }
);

export default router;
