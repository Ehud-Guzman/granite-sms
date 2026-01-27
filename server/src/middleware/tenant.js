// src/middleware/tenant.js
import { prisma } from "../lib/prisma.js";

function normalizeHeader(v) {
  if (Array.isArray(v)) return v[0];
  if (v == null) return null;
  return String(v).trim();
}

function isValidSchoolKey(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{2,64}$/.test(v);
}

// ---- tiny in-memory cache (kills DB spam)
const USER_CACHE = new Map();
const SCHOOL_CACHE = new Map();
const TTL_MS = 30_000;

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    map.delete(key);
    return null;
  }
  return hit.data;
}
function cacheSet(map, key, data, ttl = TTL_MS) {
  map.set(key, { data, exp: Date.now() + ttl });
  return data;
}

async function getUserDb(userId) {
  const id = String(userId);
  const cached = cacheGet(USER_CACHE, id);
  if (cached) return cached;

  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      schoolId: true,
      email: true,
      isActive: true,
      teacher: { select: { id: true, schoolId: true } },
      student: { select: { id: true, schoolId: true } },
    },
  });

  return cacheSet(USER_CACHE, id, u);
}

async function resolveSchoolByIdOrCodeCached(key) {
  const k = String(key || "").trim();
  if (!k) return null;

  const cached = cacheGet(SCHOOL_CACHE, k);
  if (cached) return cached;

  const s = await prisma.school.findFirst({
    where: { OR: [{ id: k }, { code: k }] },
    select: { id: true, code: true, name: true, isActive: true },
  });

  return cacheSet(SCHOOL_CACHE, k, s);
}

export async function tenantContext(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthenticated" });

    const jwtSchoolRaw = req.user?.schoolId ?? null;
    const jwtSchoolKey = jwtSchoolRaw ? String(jwtSchoolRaw).trim() : null;

    const userDb = await getUserDb(userId);

    if (!userDb || !userDb.isActive) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.role = userDb.role;
    req.userEmail = userDb.email;

    req.user = {
      ...(req.user || {}),
      id: userDb.id,
      role: userDb.role,
      schoolId: userDb.schoolId ?? null,
      teacherId: userDb.teacher?.id ?? null,
      studentId: userDb.student?.id ?? null,
    };

    req.teacherId = req.user.teacherId;
    req.studentId = req.user.studentId;

    // ---- SYSTEM_ADMIN: platform or tenant mode
    if (userDb.role === "SYSTEM_ADMIN") {
      const headerSchoolKey =
        normalizeHeader(req.headers["x-school-id"]) ||
        normalizeHeader(req.headers["x-schoolid"]) ||
        normalizeHeader(req.headers["x-tenant-id"]) ||
        null;

      // ✅ Prefer header over token (header reflects live selection)
      const effectiveKey = headerSchoolKey || jwtSchoolKey;

      if (!effectiveKey) {
        req.schoolId = null;
        req.school = null;
        req.schoolName = null;
        return next();
      }

      if (!isValidSchoolKey(effectiveKey)) {
        return res.status(400).json({ message: "Invalid X-School-Id" });
      }

      const school = await resolveSchoolByIdOrCodeCached(effectiveKey);

      if (!school) return res.status(404).json({ message: "School not found" });
      if (!school.isActive) return res.status(403).json({ message: "School inactive" });

      req.schoolId = school.id;
      req.school = school;
      req.schoolName = school.name;
      return next();
    }

    // ---- Non-system users: must be tenant-bound
    const effectiveSchoolId = userDb.schoolId;
    if (!effectiveSchoolId) {
      return res.status(403).json({ message: "No school linked to this account" });
    }

    const school = await prisma.school.findUnique({
      where: { id: String(effectiveSchoolId) },
      select: { id: true, code: true, name: true, isActive: true },
    });

    if (!school) return res.status(404).json({ message: "School not found" });
    if (!school.isActive) return res.status(403).json({ message: "School inactive" });

    if (userDb.teacher && userDb.teacher.schoolId !== school.id) {
      return res.status(403).json({ message: "Teacher profile mismatch (wrong school)" });
    }
    if (userDb.student && userDb.student.schoolId !== school.id) {
      return res.status(403).json({ message: "Student profile mismatch (wrong school)" });
    }

    req.schoolId = school.id;
    req.school = school;
    req.schoolName = school.name;
    return next();
  } catch (err) {
    console.error("TENANT CONTEXT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

export function requireTenant(req, res, next) {
  if (!req.schoolId) {
    return res.status(403).json({
      message: "Tenant required. Select a school (SYSTEM_ADMIN) or use a school user.",
      code: "TENANT_REQUIRED",
    });
  }
  return next();
}
