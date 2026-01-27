// src/middleware/auth.js
import { verifyToken } from "../utils/jwt.js";

/**
 * Parse token from:
 * - Authorization: Bearer <token>
 * - (optional) x-access-token: <token>
 *
 * Keep it stateless: DB truth happens in tenantContext.
 */
function getToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const raw = Array.isArray(header) ? header[0] : String(header);

  // Tolerate extra spaces, case-insensitive Bearer
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 2 && /^Bearer$/i.test(parts[0]) && parts[1]) {
    return parts[1].trim();
  }

  // Optional fallback (tools / some proxies)
  const x = req.headers?.["x-access-token"];
  if (typeof x === "string" && x.trim()) return x.trim();

  return null;
}

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function safeStr(v, max = 120) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeRole(role) {
  return upper(role);
}

/**
 * Map JWT errors to consistent API responses.
 * We keep responses intentionally vague (no leakage).
 */
function mapJwtError(err) {
  const name = err?.name || "AuthError";

  if (name === "TokenExpiredError") {
    return { status: 401, body: { message: "Token expired", code: "AUTH_TOKEN_EXPIRED" } };
  }

  if (name === "JsonWebTokenError") {
    // includes issuer/audience/alg mismatch, invalid signature, malformed, etc.
    return { status: 401, body: { message: "Invalid token", code: "AUTH_TOKEN_INVALID" } };
  }

  if (name === "NotBeforeError") {
    return { status: 401, body: { message: "Token not active", code: "AUTH_TOKEN_NOT_ACTIVE" } };
  }

  return { status: 401, body: { message: "Invalid or expired token", code: "AUTH_FAILED" } };
}

/**
 * ✅ requireAuth
 * - verifies JWT (signature + issuer/audience/alg hardening via verifyToken())
 * - attaches req.user = { id, role, schoolId }
 * - attaches req.auth (safe debug metadata; no secrets)
 *
 * IMPORTANT:
 * - Do NOT do DB calls here.
 * - tenantContext should do DB verification + role truth.
 */
export function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({
        message: "Missing or invalid Authorization header",
        code: "AUTH_MISSING_TOKEN",
      });
    }

    // Hard fail early if server misconfigured
    if (!process.env.JWT_SECRET) {
      console.error("AUTH ERROR: JWT_SECRET is not set");
      return res.status(500).json({
        message: "Server misconfigured",
        code: "AUTH_SERVER_MISCONFIG",
      });
    }

    // verifyToken enforces issuer/audience/alg in utils/jwt.js
    const payload = verifyToken(token);

    // Expected payload: { sub, role, schoolId, iat, exp, iss, aud }
    const userId = safeStr(payload?.sub, 80);
    const role = normalizeRole(payload?.role);
    const schoolId = payload?.schoolId ? safeStr(payload.schoolId, 80) : null;

    if (!userId || !role) {
      return res.status(401).json({
        message: "Invalid token payload",
        code: "AUTH_BAD_PAYLOAD",
      });
    }

    // Minimal identity (DB truth later)
    req.user = { id: userId, role, schoolId };

    // Useful for audit/debug (non-sensitive)
    req.auth = {
      tokenType: "Bearer",
      userId,
      role,
      schoolId,
      iat: payload?.iat ?? null,
      exp: payload?.exp ?? null,
      issuer: payload?.iss ?? null,
      audience: payload?.aud ?? null,
    };

    return next();
  } catch (err) {
    const mapped = mapJwtError(err);

    // Log the class only (no token contents)
    console.error("AUTH ERROR:", err?.name || "AuthError");

    return res.status(mapped.status).json(mapped.body);
  }
}

/**
 * ✅ requireRole
 * Uses req.role if tenantContext already set it (DB truth),
 * falls back to req.user.role (JWT) if not.
 */
export function requireRole(...roles) {
  const allowed = roles.map((r) => normalizeRole(r)).filter(Boolean);

  return (req, res, next) => {
    const effectiveRole = normalizeRole(req.role || req.user?.role);
    if (!effectiveRole || !allowed.includes(effectiveRole)) {
      return res.status(403).json({
        message: "Forbidden",
        code: "AUTH_FORBIDDEN",
      });
    }
    return next();
  };
}

/**
 * Optional helper:
 * Some endpoints want auth but allow anonymous too.
 * Example: public pages that behave better if logged in.
 */
export function tryAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return next();

  try {
    if (!process.env.JWT_SECRET) return next();

    const payload = verifyToken(token);
    const userId = safeStr(payload?.sub, 80);
    const role = normalizeRole(payload?.role);
    const schoolId = payload?.schoolId ? safeStr(payload.schoolId, 80) : null;

    if (userId && role) {
      req.user = { id: userId, role, schoolId };
      req.auth = {
        tokenType: "Bearer",
        userId,
        role,
        schoolId,
        iat: payload?.iat ?? null,
        exp: payload?.exp ?? null,
        issuer: payload?.iss ?? null,
        audience: payload?.aud ?? null,
      };
    }
  } catch {
    // swallow errors: optional auth
  }

  return next();
}
