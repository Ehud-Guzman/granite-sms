// src/routes/settings/audit.routes.js
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { clampInt } from "../../utils/http.js";
import { upper, isValidSchoolId } from "../../utils/roleScope.js";
import { exportCSV, exportXLSX } from "../../utils/export.js";

const router = Router();

const MAX_TAKE = 200;
const DEFAULT_TAKE = 50;

// Keep categories strict to avoid random junk
const ALLOWED_CATEGORIES = ["AUTH", "USERS", "FEES", "REPORTS", "SETTINGS", "SECURITY", "SYSTEM"];

// Export allowlist (prevents someone from exporting millions of rows)
const MAX_EXPORT_TAKE = 2000;
const DEFAULT_EXPORT_TAKE = 500;

// --------------------
// Helpers
// --------------------
function toStr(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

function normalizeCategory(cat) {
  const c = upper(cat || "");
  if (!c) return null;
  return ALLOWED_CATEGORIES.includes(c) ? c : null;
}

/**
 * Basic free-text search:
 * - action contains q
 * - actorEmail contains q
 * - actorId contains q
 * - targetType contains q
 * - targetId contains q
 * - metadata.category contains q (JSON search)
 *
 * Note: "mode: insensitive" requires Prisma support + compatible DB collation.
 */
function buildSearchWhere(q) {
  const s = toStr(q);
  if (!s) return null;

  return {
    OR: [
      { action: { contains: s, mode: "insensitive" } },
      { actorEmail: { contains: s, mode: "insensitive" } },
      { actorId: { contains: s } },
      { targetType: { contains: s, mode: "insensitive" } },
      { targetId: { contains: s } },
      // JSON search for metadata.category (Prisma supports json filters; if your DB/provider
      // complains, remove this line and rely on category filter only.)
      { metadata: { path: ["category"], string_contains: s } },
    ],
  };
}

/**
 * Build category filter:
 * Prisma JSON filtering: metadata: { path: ["category"], equals: "FEES" }
 */
function buildCategoryWhere(category) {
  const cat = normalizeCategory(category);
  if (!cat) return null;
  return { metadata: { path: ["category"], equals: cat } };
}

function pickExportFormat(req) {
  const raw = upper(req.query?.format || "");
  // supported: JSON (default), CSV, XLSX
  if (raw === "CSV") return "CSV";
  if (raw === "XLSX") return "XLSX";
  return "JSON";
}

function getCategoryFromMetadata(metadata) {
  const c = metadata?.category;
  return c ? upper(String(c)) : "";
}

/**
 * Fallback category derivation (backward-compatible).
 * This covers older logs created before metadata.category was injected,
 * and older action naming like LOGIN_SUCCESS / USER_CREATED / SCHOOL_PROFILE_UPDATED.
 */
function categoryFromAction(action) {
  const a = upper(action || "");

  // New convention (recommended)
  if (a.startsWith("AUTH_")) return "AUTH";
  if (a.startsWith("USERS_")) return "USERS";
  if (a.startsWith("FEES_")) return "FEES";
  if (a.startsWith("REPORTS_")) return "REPORTS";
  if (a.startsWith("SETTINGS_")) return "SETTINGS";
  if (a.startsWith("SECURITY_")) return "SECURITY";
  if (a.startsWith("SYSTEM_")) return "SYSTEM";

  // Backward compat (your existing action styles)
  if (a.startsWith("LOGIN_") || a === "PASSWORD_RESET" || a === "PASSWORD_RESET_REQUESTED") return "AUTH";
  if (a.startsWith("USER_")) return "USERS";
  if (a.startsWith("SCHOOL_") || a.includes("BRANDING") || a.includes("PROFILE")) return "SETTINGS";

  return "SYSTEM";
}

function getCategorySafe(log) {
  return getCategoryFromMetadata(log?.metadata) || categoryFromAction(log?.action);
}

function toExportRow(l) {
  return {
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : "",
    action: l.action || "",
    category: getCategorySafe(l),
    actorEmail: l.actorEmail || "",
    actorRole: l.actorRole || "",
    actorId: l.actorId || "",
    targetType: l.targetType || "",
    targetId: l.targetId || "",
    schoolId: l.schoolId || "",
    ip: l.ip || "",
    userAgent: l.userAgent || "",
  };
}

// --------------------
// GET /api/settings/audit-logs
// Query params:
// - take, cursor (cursor only works for JSON)
// - schoolId (SYSTEM_ADMIN only)
// - action, actorId, targetType, targetId
// - category (metadata.category)
// - q (free-text search)
// - format=json|csv|xlsx (default json)
// --------------------
router.get("/audit-logs", requireAuth, async (req, res) => {
  try {
    const role = upper(req.role);

    // Who can view audit logs?
    if (!["SYSTEM_ADMIN", "ADMIN"].includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const format = pickExportFormat(req);
    const isExport = format === "CSV" || format === "XLSX";

    const take = clampInt(
      req.query?.take,
      1,
      isExport ? MAX_EXPORT_TAKE : MAX_TAKE,
      isExport ? DEFAULT_EXPORT_TAKE : DEFAULT_TAKE
    );

    const cursor = toStr(req.query?.cursor);

    // filters
    const action = toStr(req.query?.action);
    const actorId = toStr(req.query?.actorId);
    const targetType = toStr(req.query?.targetType);
    const targetId = toStr(req.query?.targetId);
    const category = toStr(req.query?.category);
    const q = toStr(req.query?.q);

    const where = {};

    // scope enforcement (critical)
    if (role === "ADMIN") {
      if (!req.schoolId) return res.status(400).json({ message: "Tenant required" });
      where.schoolId = req.schoolId;
    } else {
      const qSchoolId = toStr(req.query?.schoolId);
      if (qSchoolId) {
        if (!isValidSchoolId(qSchoolId)) {
          return res.status(400).json({ message: "Invalid schoolId filter" });
        }
        where.schoolId = qSchoolId;
      }
    }

    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;

    // category filter via metadata.category
    const catWhere = buildCategoryWhere(category);
    if (category && !catWhere) {
      return res.status(400).json({
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(", ")}`,
      });
    }
    if (catWhere) Object.assign(where, catWhere);

    // q search (OR block) - merged safely via AND
    const qWhere = buildSearchWhere(q);
    if (qWhere) {
      where.AND = where.AND ? [...where.AND, qWhere] : [qWhere];
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: isExport ? take : take + 1,
      ...(cursor && !isExport ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        action: true,
        actorId: true,
        actorRole: true,
        actorEmail: true,
        schoolId: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        userAgent: true,
      },
    });

    // --------------------
    // EXPORT MODE (bounded, no cursor)
    // --------------------
    if (format === "CSV") {
      const rows = logs.map(toExportRow);

      const stamp = new Date().toISOString().slice(0, 10);
      const scopeTag = role === "ADMIN" ? (req.schoolId || "SCHOOL") : "GLOBAL";
      const filenameBase = `audit-logs-${scopeTag}-${stamp}`;

      return exportCSV(res, filenameBase, rows);
    }

    if (format === "XLSX") {
      const rows = logs.map(toExportRow);

      const stamp = new Date().toISOString().slice(0, 10);
      const scopeTag = role === "ADMIN" ? (req.schoolId || "SCHOOL") : "GLOBAL";
      const filenameBase = `audit-logs-${scopeTag}-${stamp}`;

      return exportXLSX(
        res,
        filenameBase,
        "Audit Logs",
        [
          { header: "Created At", key: "createdAt", width: 22 },
          { header: "Action", key: "action", width: 22 },
          { header: "Category", key: "category", width: 14 },
          { header: "Actor Email", key: "actorEmail", width: 24 },
          { header: "Actor Role", key: "actorRole", width: 14 },
          { header: "Actor ID", key: "actorId", width: 20 },
          { header: "Target Type", key: "targetType", width: 16 },
          { header: "Target ID", key: "targetId", width: 20 },
          { header: "School ID", key: "schoolId", width: 18 },
          { header: "IP", key: "ip", width: 18 },
          { header: "User Agent", key: "userAgent", width: 40 },
        ],
        rows
      );
    }

    // --------------------
    // JSON pagination response
    // --------------------
    const hasMore = logs.length > take;
    const page = hasMore ? logs.slice(0, take) : logs;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;

    // Add top-level category for frontend usability (don’t depend on metadata existing)
    const pageWithCategory = page.map((l) => ({
      ...l,
      category: getCategorySafe(l),
    }));

    return res.json({
      logs: pageWithCategory,
      nextCursor,
      hasMore,
      take,
      scope: role === "ADMIN" ? "SCHOOL" : "GLOBAL",
      filters: {
        schoolId: where.schoolId || null,
        action: action || null,
        actorId: actorId || null,
        targetType: targetType || null,
        targetId: targetId || null,
        category: normalizeCategory(category) || null,
        q: q || null,
      },
      allowedCategories: ALLOWED_CATEGORIES,
      export: {
        maxTake: MAX_EXPORT_TAKE,
        formats: ["CSV", "XLSX"],
      },
    });
  } catch (err) {
    console.error("AUDIT LOGS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
