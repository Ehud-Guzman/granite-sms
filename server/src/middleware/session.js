// src/middleware/session.js
// Checks that a signed token still describes a valid session, using the
// user's current database row. Shared by tenantContext, the SYSTEM_ADMIN
// control plane and the change-password route.

// While mustChangePassword is set, these are the only API calls allowed:
// reading who you are (so the client can redirect) and changing the password.
const PASSWORD_CHANGE_ALLOWED = new Set(["GET /api/me", "POST /api/auth/change-password"]);

function routeKey(req) {
  const path = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
  return `${req.method} ${path}`;
}

/**
 * Returns null when the session is fine, otherwise { status, body } to send.
 * userDb must include isActive, tokenVersion and mustChangePassword.
 */
export function sessionProblem(req, userDb, { enforcePasswordChange = true } = {}) {
  if (!userDb || !userDb.isActive) {
    return { status: 401, body: { message: "User not found or inactive", code: "AUTH_USER_INACTIVE" } };
  }

  const tokenVersion = req.auth?.tokenVersion ?? 0;
  if (tokenVersion !== (userDb.tokenVersion ?? 0)) {
    return {
      status: 401,
      body: { message: "Your session has ended. Please sign in again.", code: "AUTH_SESSION_REVOKED" },
    };
  }

  if (enforcePasswordChange && userDb.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(routeKey(req))) {
    return {
      status: 403,
      body: { message: "You must change your password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" },
    };
  }

  return null;
}
