// src/routes/auth.js
import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../utils/jwt.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { tenantContext } from "../middleware/tenant.js";
import { logAudit } from "../utils/audit.js";


const router = Router();

const cleanEmail = (email) => String(email || "").trim().toLowerCase();

const validatePassword = (password) => {
  const p = String(password || "");
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
};

const normalizeId = (v) => {
  const s = String(v || "").trim();
  return s ? s : null;
};

const getHeaderSchoolId = (req) =>
  normalizeId(
    req.headers["x-school-id"] ||
      req.headers["x-schoolid"] ||
      req.headers["x-tenant-id"] ||
      null
  );

/**
 * ----------------------------------------
 * AUTH (Base path: /api/auth)
 * ----------------------------------------
 */

/**
 * Public bootstrap signup:
 * - Allowed ONLY when ALLOW_BOOTSTRAP=true
 * - If there are NO users, create the first user as SYSTEM_ADMIN (bootstrap).
 * - After bootstrap, public signup is disabled forever (use admin endpoints).
 */
router.post("/signup", async (req, res) => {
  try {
    if (process.env.ALLOW_BOOTSTRAP !== "true") {
      return res.status(403).json({ message: "Bootstrap disabled" });
    }

    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 chars and include letters + numbers",
      });
    }

    const usersCount = await prisma.user.count();
    if (usersCount > 0) {
      // Hard stop: no public signups after bootstrap
      return res
        .status(403)
        .json({ message: "Signup disabled. Ask an admin to create your account." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: "SYSTEM_ADMIN",
        isActive: true,
        schoolId: null, // explicit
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        schoolId: true,
        createdAt: true,
      },
    });

    const token = signToken({
      sub: user.id,
      role: user.role,
      schoolId: user.schoolId ?? null,
    });

    return res.status(201).json({ user, token });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * Login (tenant-aware)
 * Body:
 * - email
 * - password
 * - schoolId (required for non-SYSTEM users; optional for SYSTEM_ADMIN)
 */
router.post("/login", async (req, res) => {
  try {
    const MAX_ATTEMPTS = 5;
    const LOCK_MINUTES = 30;

    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const schoolKeyRaw = req.body?.schoolId; // may be id or code (or omitted)
    const schoolKey = schoolKeyRaw == null ? null : String(schoolKeyRaw).trim();

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        isActive: true,
        password: true,
        mustChangePassword: true,
        failedLoginAttempts: true,
        lockUntil: true,
      },
    });

    // Generic fail (avoid user enumeration)
    if (!user || !user.isActive) {
      await logAudit({
        req,
        actorEmail: email,
        schoolId: null,
        action: "LOGIN_FAILED",
        metadata: { reason: "invalid_credentials" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Locked check
    const now = new Date();
    if (user.lockUntil && user.lockUntil > now) {
      await logAudit({
        req,
        actorId: user.id,
        actorRole: user.role,
        actorEmail: user.email,
        schoolId: user.role === "SYSTEM_ADMIN" ? null : user.schoolId,
        action: "LOGIN_BLOCKED_LOCKED",
        metadata: { lockUntil: user.lockUntil },
      });

      return res.status(403).json({
        message: "Account temporarily locked. Try again later.",
      });
    }

    // Password check
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      const nextAttempts = (user.failedLoginAttempts || 0) + 1;
      const shouldLock = nextAttempts >= MAX_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          ...(shouldLock
            ? { lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
            : {}),
        },
      });

      await logAudit({
        req,
        actorId: user.id,
        actorRole: user.role,
        actorEmail: user.email,
        schoolId: user.role === "SYSTEM_ADMIN" ? null : user.schoolId,
        action: shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        metadata: { attempts: nextAttempts, max: MAX_ATTEMPTS },
      });

      return res.status(401).json({ message: "Invalid credentials" });
    }

    // -------------------------
    // Tenant rule for non-system users
    // -------------------------
    if (user.role !== "SYSTEM_ADMIN") {
      if (!user.schoolId) {
        return res.status(403).json({ message: "No school linked to this account" });
      }

      // If caller provided schoolId, accept either id or code
      let resolvedSchool = null;

      if (schoolKey) {
        resolvedSchool = await prisma.school.findFirst({
          where: { OR: [{ id: schoolKey }, { code: schoolKey }] },
          select: { id: true, name: true, isActive: true, code: true },
        });

        if (!resolvedSchool) return res.status(404).json({ message: "School not found" });
        if (!resolvedSchool.isActive) return res.status(403).json({ message: "School inactive" });

        // Normalize compare: user.schoolId must match resolved school.id
        if (String(user.schoolId) !== String(resolvedSchool.id)) {
          await logAudit({
            req,
            actorId: user.id,
            actorRole: user.role,
            actorEmail: user.email,
            schoolId: resolvedSchool.id,
            action: "LOGIN_FAILED",
            metadata: { reason: "school_mismatch" },
          });

          return res.status(403).json({ message: "Account not in this school" });
        }
      } else {
        // No schoolId provided: use the user's schoolId directly
        resolvedSchool = await prisma.school.findUnique({
          where: { id: String(user.schoolId) },
          select: { id: true, name: true, isActive: true, code: true },
        });

        if (!resolvedSchool) return res.status(404).json({ message: "School not found" });
        if (!resolvedSchool.isActive) return res.status(403).json({ message: "School inactive" });
      }
    }

    // Success: reset counters + lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
      },
    });

    await logAudit({
      req,
      actorId: user.id,
      actorRole: user.role,
      actorEmail: user.email,
      schoolId: user.role === "SYSTEM_ADMIN" ? null : user.schoolId,
      action: "LOGIN_SUCCESS",
    });

    const token = signToken({
      sub: user.id,
      role: user.role,
      schoolId: user.role === "SYSTEM_ADMIN" ? null : (user.schoolId ?? null),
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        schoolId: user.role === "SYSTEM_ADMIN" ? null : user.schoolId,
        mustChangePassword: !!user.mustChangePassword,
      },
      token,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});




/**
 * Change password (self-service)
 * POST /api/auth/change-password
 * Body: { password: "NewPass123" }
 *
 * - Uses JWT identity (req.user.id)
 * - Sets mustChangePassword = false
 */
// POST /api/auth/change-password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        message: "Password must be at least 8 chars and include letters + numbers",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashed,
        mustChangePassword: false, // ✅ if you have this field
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});



/**
 * SYSTEM_ADMIN or school ADMIN creates a user.
 * - SYSTEM_ADMIN:
 *   - Can create ADMIN/TEACHER/STUDENT
 *   - MUST provide schoolId (body.schoolId preferred, fallback header X-School-Id)
 *   - If school doesn't exist and a name is provided, it will be created.
 * - ADMIN:
 *   - Must be tenant-scoped (via tenantContext)
 *   - Can create TEACHER/STUDENT only, inside req.schoolId
 *
 * SECURITY RULE:
 * - SYSTEM_ADMIN cannot be created via this endpoint (bootstrap only).
 */
router.post("/admin/create-user", requireAuth, tenantContext, async (req, res) => {
  try {
    const actorRole = req.role; // from tenantContext (DB verified)
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "").toUpperCase();
    let schoolId = normalizeId(req.body?.schoolId);
    const schoolName = req.body?.schoolName ? String(req.body.schoolName).trim() : null;

    if (!email || !password || !role) {
      return res.status(400).json({ message: "email, password, role are required" });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 chars and include letters + numbers",
      });
    }

    const allowedRoles = ["ADMIN", "TEACHER", "STUDENT"];
    if (!allowedRoles.includes(role)) {
      // hard stop: no SYSTEM_ADMIN creation via UI/API
      return res.status(400).json({ message: "Invalid role" });
    }

    if (actorRole === "SYSTEM_ADMIN") {
      if (!schoolId) schoolId = getHeaderSchoolId(req);

      // SYSTEM_ADMIN must specify a school for tenant users
      if (!schoolId) {
        return res.status(400).json({
          message: "schoolId is required for creating school users",
        });
      }

      // Ensure school exists (or create if name provided)
      await prisma.school.upsert({
        where: { id: schoolId },
        update: schoolName ? { name: schoolName } : {},
        create: { id: schoolId, name: schoolName || "Unnamed School", isActive: true },
      });
    } else if (actorRole === "ADMIN") {
      if (!req.schoolId) {
        return res.status(403).json({ message: "Tenant context required" });
      }
      if (!["TEACHER", "STUDENT"].includes(role)) {
        return res.status(403).json({ message: "ADMIN can only create TEACHER or STUDENT" });
      }
      schoolId = req.schoolId;
    } else {
      return res.status(403).json({ message: "Forbidden" });
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
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        schoolId: true,
        createdAt: true,
      },
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error("ADMIN CREATE USER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * SYSTEM_ADMIN: assign/change a user's school
 * - Prevent touching SYSTEM_ADMIN accounts.
 */
router.patch(
  "/users/:id/school",
  requireAuth,
  tenantContext,
  requireRole("SYSTEM_ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const bodySchoolId = normalizeId(req.body?.schoolId);
      const schoolName = req.body?.schoolName ? String(req.body.schoolName).trim() : null;

      if (!bodySchoolId) return res.status(400).json({ message: "schoolId is required" });

      const target = await prisma.user.findUnique({
        where: { id: String(id) },
        select: { id: true, role: true },
      });

      if (!target) return res.status(404).json({ message: "User not found" });
      if (target.role === "SYSTEM_ADMIN") {
        return res.status(403).json({ message: "Cannot re-scope SYSTEM_ADMIN accounts" });
      }

      await prisma.school.upsert({
        where: { id: bodySchoolId },
        update: schoolName ? { name: schoolName } : {},
        create: { id: bodySchoolId, name: schoolName || "Unnamed School", isActive: true },
      });

      const updated = await prisma.user.update({
        where: { id: String(id) },
        data: { schoolId: bodySchoolId },
        select: { id: true, email: true, role: true, isActive: true, schoolId: true },
      });

      return res.json(updated);
    } catch (err) {
      console.error("SET USER SCHOOL ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);



/**
 * DEV ONLY: SYSTEM_ADMIN impersonate a user (issues token without password)
 * POST /api/auth/impersonate
 * Body: { userId }
 */
router.post("/impersonate", requireAuth, requireRole("SYSTEM_ADMIN"), async (req, res) => {
  try {
    if (process.env.ALLOW_IMPERSONATION !== "true") {
      return res.status(403).json({ message: "Impersonation disabled" });
    }

    const userId = String(req.body?.userId || "").trim();
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        isActive: true,
        mustChangePassword: true,
      },
    });

    if (!target || !target.isActive) {
      return res.status(404).json({ message: "User not found or inactive" });
    }

    // Optional: block impersonating SYSTEM_ADMIN to avoid recursion/confusion
    // if (target.role === "SYSTEM_ADMIN") return res.status(403).json({ message: "Cannot impersonate SYSTEM_ADMIN" });

    const token = signToken({
      sub: target.id,
      role: target.role,
      schoolId: target.schoolId ?? null,
    });

    return res.json({
      token,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        schoolId: target.schoolId,
        mustChangePassword: !!target.mustChangePassword,
      },
    });
  } catch (err) {
    console.error("IMPERSONATE ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


/**
 * Current user (who am I)
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    // requireAuth sets req.user.id (not sub)
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: { id: true, email: true, role: true, isActive: true, schoolId: true },
    });

    if (!user || !user.isActive) return res.status(401).json({ message: "Unauthorized" });

    return res.json({ user });
  } catch (err) {
    console.error("ME ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * SYSTEM_ADMIN: select a school context (issues a new token containing schoolId)
 */
router.post("/select-school", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "SYSTEM_ADMIN") {
      return res.status(403).json({ message: "Only SYSTEM_ADMIN can switch schools" });
    }

    const schoolKey = normalizeId(req.body?.schoolId);
    if (!schoolKey) {
      return res.status(400).json({ message: "schoolId required" });
    }

    // ✅ Accept either school.id OR school.code
    const school = await prisma.school.findFirst({
      where: {
        OR: [{ id: schoolKey }, { code: schoolKey }],
      },
      select: { id: true, code: true, name: true, isActive: true },
    });

    if (!school) return res.status(404).json({ message: "School not found" });
    if (!school.isActive) return res.status(403).json({ message: "School inactive" });

    const token = signToken({
      sub: req.user.id,
      role: "SYSTEM_ADMIN",
      schoolId: school.id, // normalize to real id always
    });

    return res.json({
      token,
      school,
      user: {
        id: req.user.id,
        role: "SYSTEM_ADMIN",
        schoolId: school.id,
      },
    });
  } catch (err) {
    console.error("SELECT SCHOOL ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Deprecated: replaced by /api/users (single source of truth)
// Keeping this route to avoid breaking older clients, but it is intentionally disabled.
router.post("/admin/create-user", requireAuth, tenantContext, async (req, res) => {
  return res.status(410).json({
    message: "Deprecated endpoint. Use POST /api/users instead.",
    code: "DEPRECATED",
  });
});


export default router;
