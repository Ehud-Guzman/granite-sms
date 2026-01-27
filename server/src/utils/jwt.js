// src/utils/jwt.js
import jwt from "jsonwebtoken";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeId(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function normalizeRole(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return s || null;
}

function normalizeSchoolId(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * Sign a JWT.
 *
 * Payload expectations:
 * - sub: user id (string)
 * - role: role (string)
 * - schoolId: tenant id or null (string|null)
 *
 * Notes:
 * - We also mirror `sub` into the standard JWT "sub" claim.
 * - We keep `role` and `schoolId` as custom claims.
 */
export function signToken(payload = {}, opts = {}) {
  const secret = requireEnv("JWT_SECRET");

  const issuer = process.env.JWT_ISSUER || "sms-api";
  const audience = process.env.JWT_AUDIENCE || "sms-client";
  const algorithm = process.env.JWT_ALGORITHM || "HS256";
  const expiresIn = opts.expiresIn || process.env.JWT_EXPIRES_IN || "7d";

  // Normalize payload
  const sub = normalizeId(payload.sub ?? payload.id);
  const role = normalizeRole(payload.role);
  const schoolId = normalizeSchoolId(payload.schoolId);

  if (!sub) throw new Error("signToken: payload.sub is required");
  if (!role) throw new Error("signToken: payload.role is required");

  const claims = {
    // Standard claim
    sub,
    // Custom claims
    role,
    schoolId: schoolId ?? null,
  };

  return jwt.sign(claims, secret, {
    expiresIn,
    issuer,
    audience,
    algorithm,
  });
}

/**
 * Verify a JWT with consistent hardening.
 * Use this in requireAuth if you want a single source of truth.
 */
export function verifyToken(token) {
  const secret = requireEnv("JWT_SECRET");

  const issuer = process.env.JWT_ISSUER || "sms-api";
  const audience = process.env.JWT_AUDIENCE || "sms-client";
  const algorithm = process.env.JWT_ALGORITHM || "HS256";

  return jwt.verify(token, secret, {
    issuer,
    audience,
    algorithms: [algorithm],
    // clockTolerance: 5, // optionally enable if you have clock drift issues
  });
}
