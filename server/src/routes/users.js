// src/routes/users.js
import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../utils/audit.js";

import { loadSubscription, requireLimit } from "../middleware/subscription.js";

// ✅ Ensure auth + tenant context for every /api/users request
import { requireAuth } from "../middleware/auth.js";
import { tenantContext, requireTenant } from "../middleware/tenant.js";

const router = Router();

// ✅ Critical: without this, req.role is undefined => 403 everywhere
// IMPORTANT: do NOT load subscription globally here.
// SYSTEM_ADMIN platform-mode (no tenant selected) must still be able to list/search users.
router.use(requireAuth, tenantContext);

// For write routes, allow SYSTEM_ADMIN to supply body.schoolId even if no tenant selected.
// Then enforce tenant + load subscription for plan gates.
function tenantFromBodyForSystemAdmin(req, res, next) {
  if (req.schoolId) return next();

  const role = String(req.role || "").toUpperCase();
  if (role !== "SYSTEM_ADMIN") {
    return res.status(400).json({
      message:
        "Tenant required. Select a school (SYSTEM_ADMIN) or use a school user.",
    });
  }

  const bodySchoolId = req.body?.schoolId ? String(req.body.schoolId).trim() : "";
  if (!bodySchoolId) {
    return res.status(400).json({ message: "schoolId is required" });
  }
  if (!isValidSchoolId(bodySchoolId)) {
    return res.status(400).json({ message: "Invalid schoolId" });
  }

  // Assign tenant context for downstream middlewares (subscription/limits)
  req.schoolId = bodySchoolId;
  return next();
}

// -----------------------------
// Helpers
// -----------------------------
const cleanEmail = (email) => String(email || "").trim().toLowerCase();

const validatePassword = (password) => {
  const p = String(password || "");
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
};

function isValidSchoolId(v) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(String(v || "").trim());
}

// Never allow SYSTEM_ADMIN creation/modification via this UI API
const UI_ALLOWED_ROLES = ["ADMIN", "TEACHER", "BURSAR", "STUDENT"];

function assertUiRole(role) {
  const r = String(role || "").toUpperCase();
  return UI_ALLOWED_ROLES.includes(r) ? r : null;
}

function safeUserSelect() {
  return {
    id: true,
    email: true,
    role: true,
    isActive: true,
    schoolId: true,
    createdAt: true,
    mustChangePassword: true,
    failedLoginAttempts: true,
    lockUntil: true,
    lastLoginAt: true,
  };
}

function generateTempPassword(len = 16) {
  // base64url => letters+digits+_- ; append "A1" to guarantee letter+digit
  const base = crypto.randomBytes(24).toString("base64url");
  return (base.slice(0, Math.max(len - 2, 10)) + "A1").slice(0, len);
}

async function assertSchoolActive(schoolId) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, name: true },
  });
  if (!school) return { ok: false, code: 404, message: "School not found" };
  if (!school.isActive) return { ok: false, code: 403, message: "School is suspended" };
  return { ok: true, school };
}

function isActor(role, ...allowed) {
  const r = String(role || "").toUpperCase();
  return allowed.includes(r);
}

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.role || null,
    actorEmail: req.userEmail || null,
  };
}

// -----------------------------
// GET /api/users
// SYSTEM_ADMIN: all users (optional ?schoolId=)
// ADMIN: only within their school
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const actorRole = String(req.role || "").toUpperCase();

    if (!isActor(actorRole, "SYSTEM_ADMIN", "ADMIN")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const where = {};

    if (actorRole === "ADMIN") {
      if (!req.schoolId) return res.status(403).json({ message: "Tenant context required" });
      where.schoolId = req.schoolId;
    }

    if (actorRole === "SYSTEM_ADMIN") {
      const qSchoolId = req.query?.schoolId ? String(req.query.schoolId).trim() : "";
      if (qSchoolId) {
        if (!isValidSchoolId(qSchoolId)) {
          return res.status(400).json({ message: "Invalid schoolId filter" });
        }
        where.schoolId = qSchoolId;
      }
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: safeUserSelect(),
    });

    return res.json({ users });
  } catch (err) {
    console.error("LIST USERS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// POST /api/users (Create user)
// - subscription + cap enforced (POST only)
// - SYSTEM_ADMIN can supply body.schoolId even in platform mode
// -----------------------------
router.post(
  "/",
  tenantFromBodyForSystemAdmin,
  requireTenant,
  loadSubscription,
  requireLimit("users"),
  async (req, res) => {
    try {
      const actorRole = String(req.role || "").toUpperCase();

      if (!isActor(actorRole, "SYSTEM_ADMIN", "ADMIN")) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const email = cleanEmail(req.body?.email);
      const role = assertUiRole(req.body?.role);

      const bodySchoolId = req.body?.schoolId ? String(req.body.schoolId).trim() : null;

      // password optional
      const providedPassword = req.body?.password ? String(req.body.password) : "";
      const generatedPassword = !providedPassword;
      const password = providedPassword || generateTempPassword(16);

      if (!email || !role) {
        return res.status(400).json({ message: "email and role are required" });
      }

      if (!validatePassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 chars and include letters + numbers",
        });
      }

      let schoolId = null;

      if (actorRole === "ADMIN") {
        if (!req.schoolId) return res.status(403).json({ message: "Tenant context required" });

        if (!["TEACHER", "STUDENT", "BURSAR"].includes(role)) {
          return res.status(403).json({ message: "ADMIN can only create TEACHER, STUDENT, or BURSAR" });
        }

        schoolId = req.schoolId;
      }

      if (actorRole === "SYSTEM_ADMIN") {
        if (!bodySchoolId) {
          return res.status(400).json({ message: "schoolId is required" });
        }
        if (!isValidSchoolId(bodySchoolId)) {
          return res.status(400).json({ message: "Invalid schoolId" });
        }

        const check = await assertSchoolActive(bodySchoolId);
        if (!check.ok) return res.status(check.code).json({ message: check.message });

        schoolId = bodySchoolId;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ message: "Email already exists" });

      const hashed = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashed,
          role,
          isActive: true,
          schoolId,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
        select: safeUserSelect(),
      });

   await logAudit(req, {
  action: "USER_CREATED",
  targetType: "USER",
  targetId: user.id,
  metadata: {
    schoolId,
    role,
    generatedPassword,
  },
});

      return res.status(201).json({
        user,
        tempPassword: generatedPassword ? password : null,
      });
    } catch (err) {
      console.error("CREATE USER ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// -----------------------------
// PATCH /api/users/:id
// (unchanged logic, subscription not required for updates)
// -----------------------------
router.patch("/:id", async (req, res) => {
  try {
    const actorRole = String(req.role || "").toUpperCase();
    if (!isActor(actorRole, "SYSTEM_ADMIN", "ADMIN")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const id = String(req.params.id);

    const nextEmail = req.body?.email ? cleanEmail(req.body.email) : null;
    const nextRole = req.body?.role ? assertUiRole(req.body.role) : null;
    const nextSchoolId = req.body?.schoolId ? String(req.body.schoolId).trim() : null;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, schoolId: true, email: true },
    });
    if (!target) return res.status(404).json({ message: "User not found" });

    if (String(target.role).toUpperCase() === "SYSTEM_ADMIN") {
      return res.status(403).json({ message: "Cannot modify SYSTEM_ADMIN accounts" });
    }

    if (actorRole === "ADMIN") {
      if (!req.schoolId) return res.status(403).json({ message: "Tenant context required" });
      if (target.schoolId !== req.schoolId) return res.status(403).json({ message: "Forbidden" });

      if (nextRole && !["TEACHER", "STUDENT", "BURSAR"].includes(nextRole)) {
        return res.status(403).json({ message: "ADMIN cannot assign that role" });
      }

      if (nextSchoolId && nextSchoolId !== req.schoolId) {
        return res.status(403).json({ message: "ADMIN cannot move users across schools" });
      }
    }

    if (actorRole === "SYSTEM_ADMIN") {
      if (nextSchoolId) {
        if (!isValidSchoolId(nextSchoolId)) {
          return res.status(400).json({ message: "Invalid schoolId" });
        }
        const check = await assertSchoolActive(nextSchoolId);
        if (!check.ok) return res.status(check.code).json({ message: check.message });
      }
    }

    if (nextEmail && nextEmail !== target.email) {
      const exists = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (exists) return res.status(409).json({ message: "Email already exists" });
    }

    const changed = {
      email: !!(nextEmail && nextEmail !== target.email),
      role: !!(nextRole && nextRole !== target.role),
      schoolId: !!(nextSchoolId && nextSchoolId !== target.schoolId),
    };

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(nextEmail ? { email: nextEmail } : {}),
        ...(nextRole ? { role: nextRole } : {}),
        ...(nextSchoolId ? { schoolId: nextSchoolId } : {}),
      },
      select: safeUserSelect(),
    });

    const action = changed.role ? "USER_ROLE_CHANGED" : "USER_UPDATED";

await logAudit(req, {
  action,
  targetType: "USER",
  targetId: updated.id,
  metadata: {
    schoolId: updated.schoolId,
    changed,
    from: { email: target.email, role: target.role, schoolId: target.schoolId },
    to: { email: updated.email, role: updated.role, schoolId: updated.schoolId },
  },
});


    return res.json({ user: updated });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// POST /api/users/:id/status
// -----------------------------
router.post("/:id/status", async (req, res) => {
  try {
    const actorRole = String(req.role || "").toUpperCase();
    if (!isActor(actorRole, "SYSTEM_ADMIN", "ADMIN")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const id = String(req.params.id);
    const isActive = !!req.body?.isActive;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, schoolId: true, isActive: true },
    });
    if (!target) return res.status(404).json({ message: "User not found" });

    if (String(target.role).toUpperCase() === "SYSTEM_ADMIN") {
      return res.status(403).json({ message: "Cannot modify SYSTEM_ADMIN accounts" });
    }

    if (actorRole === "ADMIN") {
      if (!req.schoolId) return res.status(403).json({ message: "Tenant context required" });
      if (target.schoolId !== req.schoolId) return res.status(403).json({ message: "Forbidden" });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: safeUserSelect(),
    });

  await logAudit(req, {
  action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
  targetType: "USER",
  targetId: updated.id,
  metadata: { schoolId: updated.schoolId, from: target.isActive, to: isActive },
});


    return res.json({ user: updated });
  } catch (err) {
    console.error("SET USER STATUS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// POST /api/users/:id/reset-password
// -----------------------------
router.post("/:id/reset-password", async (req, res) => {
  try {
    const actorRole = String(req.role || "").toUpperCase();
    if (!isActor(actorRole, "SYSTEM_ADMIN", "ADMIN")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const id = String(req.params.id);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, schoolId: true, email: true },
    });
    if (!target) return res.status(404).json({ message: "User not found" });

    if (String(target.role).toUpperCase() === "SYSTEM_ADMIN") {
      return res.status(403).json({ message: "Cannot reset SYSTEM_ADMIN password here" });
    }

    if (actorRole === "ADMIN") {
      if (!req.schoolId) return res.status(403).json({ message: "Tenant context required" });
      if (target.schoolId !== req.schoolId) return res.status(403).json({ message: "Forbidden" });
    }

    const providedPassword = req.body?.password ? String(req.body.password) : "";
    const generatedPassword = !providedPassword;
    const nextPassword = providedPassword || generateTempPassword(16);

    if (!validatePassword(nextPassword)) {
      return res.status(400).json({
        message: "Password must be at least 8 chars and include letters + numbers",
      });
    }

    const hashed = await bcrypt.hash(nextPassword, 10);

    await prisma.user.update({
      where: { id },
      data: {
        password: hashed,
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    });

   await logAudit(req, {
  action: "PASSWORD_RESET",
  targetType: "USER",
  targetId: target.id,
  metadata: { schoolId: target.schoolId, generatedPassword },
});


    return res.json({
      ok: true,
      tempPassword: generatedPassword ? nextPassword : null,
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
