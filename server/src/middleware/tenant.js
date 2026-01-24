// src/middleware/tenant.js
import { prisma } from "../lib/prisma.js";

function normalizeHeader(v) {
  if (Array.isArray(v)) return v[0];
  if (v == null) return null;
  return String(v).trim();
}

function isValidSchoolKey(v) {
  // Accept either:
  // - cuid-like ids
  // - short codes like KPS / KMT
  // Keep strict enough to block garbage
  return typeof v === "string" && /^[a-zA-Z0-9_-]{2,64}$/.test(v);
}

async function resolveSchoolByIdOrCode(key) {
  const k = String(key || "").trim();
  if (!k) return null;

  return prisma.school.findFirst({
    where: { OR: [{ id: k }, { code: k }] },
    select: { id: true, code: true, name: true, isActive: true },
  });
}

export async function tenantContext(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthenticated" });

    const jwtSchoolRaw = req.user?.schoolId ?? null;
    const jwtSchoolKey = jwtSchoolRaw ? String(jwtSchoolRaw).trim() : null;

    // ✅ DB truth: role/school/active + linked profiles
    const userDb = await prisma.user.findUnique({
      where: { id: String(userId) },
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

    if (!userDb || !userDb.isActive) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    // ✅ Always prefer DB truth for role
    req.role = userDb.role;
    req.userEmail = userDb.email;

    // ✅ Enrich req.user for downstream modules (EXAMS needs teacherId)
    req.user = {
      ...(req.user || {}),
      id: userDb.id,
      role: userDb.role,
      schoolId: userDb.schoolId ?? null,
      teacherId: userDb.teacher?.id ?? null,
      studentId: userDb.student?.id ?? null,
    };

    // Optional convenience (if you like)
    req.teacherId = req.user.teacherId;
    req.studentId = req.user.studentId;

    // -----------------------------
    // SYSTEM_ADMIN: may operate with or without tenant context
    // -----------------------------
    if (userDb.role === "SYSTEM_ADMIN") {
      const headerSchoolKey =
        normalizeHeader(req.headers["x-school-id"]) ||
        normalizeHeader(req.headers["x-schoolid"]) ||
        normalizeHeader(req.headers["x-tenant-id"]) ||
        null;

      // Prefer token context, fallback to header
      const effectiveKey = jwtSchoolKey || headerSchoolKey;

      // Platform mode (no school selected)
      if (!effectiveKey) {
        req.schoolId = null;
        req.school = null;
        req.schoolName = null;
        return next();
      }

      if (!isValidSchoolKey(effectiveKey)) {
        return res.status(400).json({ message: "Invalid X-School-Id" });
      }

      const school = await resolveSchoolByIdOrCode(effectiveKey);

      if (!school) return res.status(404).json({ message: "School not found" });
      if (!school.isActive) return res.status(403).json({ message: "School inactive" });

      req.schoolId = school.id;
      req.school = school;
      req.schoolName = school.name;
      return next();
    }

    // -----------------------------
    // Non-system users MUST be tenant-bound (no headers accepted)
    // -----------------------------
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

    // ✅ Hard enforce: teacher/student profile (if present) must belong to same school
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
    return res.status(400).json({
      message: "Tenant required. Select a school (SYSTEM_ADMIN) or use a school user.",
    });
  }
  return next();
}
