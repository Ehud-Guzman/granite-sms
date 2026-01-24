// src/middleware/auth.js
import jwt from "jsonwebtoken";

/**
 * Parse "Authorization: Bearer <token>"
 */
function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token.trim();
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

/**
 * ✅ requireAuth
 * - verifies JWT
 * - attaches req.user = { id, role, schoolId }
 *
 * IMPORTANT:
 * - Do NOT do DB calls here unless you absolutely must.
 * - tenantContext should do DB verification + role truth.
 */
export function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ message: "Missing or invalid Authorization header" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      // optional hardening (uncomment if you set these in login)
      // issuer: "sms-api",
      // audience: "sms-client",
      // algorithms: ["HS256"],
      // clockTolerance: 5,
    });

    // payload expected: { sub, role, schoolId, iat, exp }
    const userId = String(payload?.sub || "").trim();
    const role = normalizeRole(payload?.role);
    const schoolId = payload?.schoolId ? String(payload.schoolId).trim() : null;

    if (!userId || !role) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    req.user = { id: userId, role, schoolId };
    return next();
  } catch (err) {
    // don't leak details
    console.error("AUTH ERROR:", err?.name || err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * ✅ requireRole
 * Uses req.role if tenantContext already set it (DB truth),
 * falls back to req.user.role (JWT) if not.
 */
export function requireRole(...roles) {
  const allowed = roles.map((r) => normalizeRole(r));

  return (req, res, next) => {
    const effectiveRole = normalizeRole(req.role || req.user?.role);

    if (!effectiveRole || !allowed.includes(effectiveRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}
