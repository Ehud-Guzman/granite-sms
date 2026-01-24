// src/utils/roleScope.js
export function upper(s) {
  return String(s || "").trim().toUpperCase();
}

export function isValidSchoolId(v) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(String(v || "").trim());
}

/**
 * Resolve school scope depending on role.
 *
 * Default:
 * - ADMIN, SYSTEM_ADMIN only
 *
 * Options:
 * - allowPlatform: SYSTEM_ADMIN can operate in platform mode (schoolId=null)
 * - allowRoles: override roles allowed to resolve school scope (useful for read-only endpoints)
 */
export function resolveSchoolScope(
  req,
  { allowPlatform = false, allowRoles = ["SYSTEM_ADMIN", "ADMIN"] } = {}
) {
  const role = upper(req.role);

  // ✅ configurable allowlist
  const allowed = (allowRoles || []).map(upper);
  if (!allowed.includes(role)) {
    return { ok: false, code: 403, message: "Forbidden" };
  }

  // ADMIN-like tenant users (including TEACHER/BURSAR/etc when allowedRoles includes them)
  // They must have a schoolId bound to the request context.
  if (role !== "SYSTEM_ADMIN") {
    if (!req.schoolId) return { ok: false, code: 400, message: "Tenant required" };
    return { ok: true, role, schoolId: req.schoolId, scope: "SCHOOL" };
  }

  // SYSTEM_ADMIN
  const qSchoolId = req.query?.schoolId ? String(req.query.schoolId).trim() : null;
  if (qSchoolId) {
    if (!isValidSchoolId(qSchoolId)) return { ok: false, code: 400, message: "Invalid schoolId" };
    return { ok: true, role, schoolId: qSchoolId, scope: "SCHOOL" };
  }

  if (req.schoolId) {
    return { ok: true, role, schoolId: req.schoolId, scope: "SCHOOL" };
  }

  if (allowPlatform) {
    return { ok: true, role, schoolId: null, scope: "PLATFORM" };
  }

  return { ok: false, code: 400, message: "schoolId is required" };
}
