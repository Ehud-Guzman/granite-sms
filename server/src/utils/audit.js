// src/utils/audit.js
import { prisma } from "../lib/prisma.js";
import { upper } from "./validate.js";

/**
 * Auto-categorize based on action naming conventions.
 * You can tune these once and forget it.
 *
 * Recommended action style:
 * - AUTH_LOGIN_SUCCESS, AUTH_LOGIN_FAILED
 * - USERS_CREATED, USERS_UPDATED, USERS_SUSPENDED
 * - FEES_PAYMENT_POSTED, FEES_PAYMENT_REVERSED, FEES_INVOICE_VOIDED
 * - REPORTS_FEES_COLLECTIONS_VIEWED
 * - SETTINGS_BRANDING_UPDATED
 */
const CATEGORY_RULES = [
  { prefix: "AUTH_", category: "AUTH" },
  { prefix: "USERS_", category: "USERS" },
  { prefix: "FEES_", category: "FEES" },
  { prefix: "REPORTS_", category: "REPORTS" },
  { prefix: "SETTINGS_", category: "SETTINGS" },
  { prefix: "SECURITY_", category: "SECURITY" },
  { prefix: "SYSTEM_", category: "SYSTEM" },
];

// Hard limits (prevents oversized JSON / accidental dumps)
const MAX_METADATA_BYTES = 8_000; // ~8KB (safe default)
const MAX_UA_LENGTH = 512;
const MAX_ACTION_LENGTH = 80;
const MAX_TARGET_TYPE_LENGTH = 40;
const MAX_TARGET_ID_LENGTH = 80;

function clampStr(v, maxLen) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function getCategoryFromAction(action) {
  const a = upper(action);
  for (const rule of CATEGORY_RULES) {
    if (a.startsWith(rule.prefix)) return rule.category;
  }
  return "SYSTEM"; // fallback
}

function safeJsonByteLength(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), "utf8");
  } catch {
    return Infinity;
  }
}

function safeMetadata(input, category) {
  // Always store JSON object (or null)
  if (!input && !category) return null;

  let meta = null;

  // If they pass a string by mistake, wrap it
  if (typeof input === "string") {
    meta = { note: input };
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    meta = { ...input };
  } else if (Array.isArray(input)) {
    meta = { list: input };
  } else if (input === null || input === undefined) {
    meta = {};
  } else {
    meta = { value: input };
  }

  // Inject category unless already explicitly set
  if (!meta.category) meta.category = category;

  // Clamp size
  const bytes = safeJsonByteLength(meta);
  if (bytes <= MAX_METADATA_BYTES) return meta;

  // If too big, keep only the essentials
  return {
    category: meta.category || category,
    truncated: true,
    originalSizeBytes: bytes,
  };
}

function parseClientIp(req) {
  if (!req) return null;

  const xf = req.headers?.["x-forwarded-for"];
  const xr = req.headers?.["x-real-ip"];

  let ip =
    (typeof xf === "string" ? xf.split(",")[0]?.trim() : null) ||
    (typeof xr === "string" ? xr.trim() : null) ||
    req.socket?.remoteAddress ||
    null;

  if (!ip) return null;

  // Normalize IPv6 mapped IPv4 like ::ffff:127.0.0.1
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  return ip;
}

/**
 * actorCtx: standard { actorId, actorRole, actorEmail } derived from a request.
 *
 * Was previously copy-pasted (with minor fallback-order drift) across ~11 route
 * files. req.role/req.userEmail are the DB-verified values set by tenantContext;
 * req.user.role/req.user.email are the raw-JWT fallback for routes that run
 * before/without tenantContext (e.g. the SYSTEM_ADMIN-only /api/schools router).
 */
export function actorCtx(req) {
  return {
    actorId: req?.user?.id || null,
    actorRole: req?.role || req?.user?.role || null,
    actorEmail: req?.userEmail || req?.user?.email || null,
  };
}

/**
 * logAudit: "never fail main request" logging utility.
 *
 * Usage:
 * await logAudit({ req, action: "FEES_PAYMENT_POSTED", schoolId, targetType:"FeePayment", targetId, metadata:{...} })
 *
 * IMPORTANT: takes exactly ONE options object. A previous bug pattern in this
 * codebase called it as `logAudit(req, { action, ... })` — a two-argument
 * positional call. Since this function only declares one parameter, the
 * second argument (the real payload) was silently dropped and `action` ended
 * up undefined, so the audit wrote nothing with zero indication anything was
 * wrong. Both failure modes below are now loud (console.error + stack) so a
 * regression like that is caught immediately instead of discovered months
 * later as "why is this action missing from the audit log".
 */
export async function logAudit(opts = {}) {
  try {
    if (arguments.length > 1) {
      console.error(
        "AUDIT LOG ERROR: logAudit() called with multiple positional arguments " +
          "(expected a single options object: logAudit({ req, action, ... })). " +
          "Nothing was audited.",
        new Error().stack
      );
      return;
    }

    const {
      req = null,
      actorId = null,
      actorRole = null,
      actorEmail = null,
      schoolId = null,
      action,
      targetType = null,
      targetId = null,
      metadata = null,
    } = opts || {};

    if (!action) {
      console.error(
        "AUDIT LOG ERROR: logAudit() called without an `action`. Nothing was audited.",
        new Error().stack
      );
      return;
    }

    const actionNorm = clampStr(upper(action), MAX_ACTION_LENGTH);
    if (!actionNorm) return;

    const category = getCategoryFromAction(actionNorm);

    const ip = parseClientIp(req);
    const userAgent = clampStr(req?.headers?.["user-agent"] || null, MAX_UA_LENGTH);

    const data = {
      actorId: clampStr(actorId, 80),
      actorRole: clampStr(actorRole ? upper(actorRole) : null, 30),
      actorEmail: clampStr(actorEmail, 120),
      schoolId: clampStr(schoolId, 80),
      action: actionNorm,
      targetType: clampStr(targetType, MAX_TARGET_TYPE_LENGTH),
      targetId: clampStr(targetId, MAX_TARGET_ID_LENGTH),
      metadata: safeMetadata(metadata, category),
      ip,
      userAgent,
    };

    await prisma.auditLog.create({ data });
  } catch (err) {
    // Never break the main request because logging failed
    console.error("AUDIT LOG ERROR:", err);
  }
}
