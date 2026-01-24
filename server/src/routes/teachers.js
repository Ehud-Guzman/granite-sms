// src/routes/teachers.js
import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, requireLimit } from "../middleware/subscription.js";
import { logAudit } from "../utils/audit.js";

const router = Router();

// Tenant is the source of truth (req.schoolId, req.role, req.user, etc.)
router.use(requireTenant);

// Load subscription for limits/entitlements (Phase 1)
router.use(loadSubscription);

// -----------------------------
// Helpers
// -----------------------------
const cleanStr = (v) => (typeof v === "string" ? v.trim() : "");
const cleanEmail = (email) => String(email || "").trim().toLowerCase();

const validatePassword = (password) => {
  const p = String(password || "");
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
};

function safeTeacherSelect() {
  return {
    id: true,
    schoolId: true,
    userId: true,
    firstName: true,
    lastName: true,
    phone: true,
    createdAt: true,
    user: {
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        schoolId: true,
        createdAt: true,
      },
    },
  };
}

/**
 * TEACHERS
 * Base path: /api/teachers
 *
 * Tenancy rules:
 * - Teacher records belong to a schoolId.
 * - Creating a teacher also creates a User and binds user.schoolId = req.schoolId.
 */

// -----------------------------
// ADMIN: Create teacher
// -----------------------------
router.post(
  "/",
  requireRole("ADMIN"),
  requireLimit("teachers"), // ✅ uses subscription.js caps (maxTeachers)
  async (req, res) => {
    try {
      const schoolId = req.schoolId;

      const email = cleanEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const firstName = cleanStr(req.body?.firstName);
      const lastName = cleanStr(req.body?.lastName);
      const phone = req.body?.phone ? cleanStr(req.body.phone) : null;

      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({
          message: "email, password, firstName, lastName are required",
        });
      }

      if (!validatePassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 chars and include letters + numbers",
        });
      }

      // Prevent email collisions globally (since users are global)
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ message: "Email already exists" });

      const hashed = await bcrypt.hash(password, 10);

      const teacher = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            password: hashed,
            role: "TEACHER",
            isActive: true,
            schoolId, // ✅ bind user to tenant
          },
          select: { id: true },
        });

        const t = await tx.teacher.create({
          data: {
            schoolId,
            userId: user.id,
            firstName,
            lastName,
            phone,
          },
          select: safeTeacherSelect(),
        });

        return t;
      });

      // Audit
      await logAudit({
        req,
        schoolId,
        action: "TEACHER_CREATED",
        targetType: "TEACHER",
        targetId: teacher.id,
        metadata: {
          userId: teacher.userId,
          email: teacher.user?.email,
          name: `${teacher.firstName} ${teacher.lastName}`.trim(),
        },
      });

      return res.status(201).json(teacher);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "Duplicate value (email/userId/unique field)",
        });
      }
      console.error("CREATE TEACHER ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// -----------------------------
// ADMIN + TEACHER: List teachers (tenant scoped)
// -----------------------------
router.get("/", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  try {
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: req.schoolId },
      orderBy: { createdAt: "desc" },
      select: safeTeacherSelect(),
    });

    return res.json(teachers);
  } catch (err) {
    console.error("LIST TEACHERS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// ADMIN + TEACHER: Get one teacher (tenant scoped)
// -----------------------------
router.get("/:id", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id: String(req.params.id), schoolId: req.schoolId },
      select: safeTeacherSelect(),
    });

    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    return res.json(teacher);
  } catch (err) {
    console.error("GET TEACHER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// ADMIN: Update teacher profile (tenant scoped)
// -----------------------------
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const id = String(req.params.id);

    const data = {};
    if ("firstName" in req.body) data.firstName = cleanStr(req.body.firstName);
    if ("lastName" in req.body) data.lastName = cleanStr(req.body.lastName);
    if ("phone" in req.body) data.phone = req.body.phone ? cleanStr(req.body.phone) : null;

    // Ensure teacher belongs to this school
    const existing = await prisma.teacher.findFirst({
      where: { id, schoolId: req.schoolId },
      select: { id: true, firstName: true, lastName: true, phone: true, userId: true },
    });
    if (!existing) return res.status(404).json({ message: "Teacher not found" });

    const updated = await prisma.teacher.update({
      where: { id: existing.id },
      data,
      select: safeTeacherSelect(),
    });

    await logAudit({
      req,
      schoolId: req.schoolId,
      action: "TEACHER_UPDATED",
      targetType: "TEACHER",
      targetId: updated.id,
      metadata: {
        from: { firstName: existing.firstName, lastName: existing.lastName, phone: existing.phone },
        to: { firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone },
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("UPDATE TEACHER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// ADMIN: Deactivate teacher (disables the user account) (tenant scoped)
// -----------------------------
router.patch("/:id/deactivate", requireRole("ADMIN"), async (req, res) => {
  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id: String(req.params.id), schoolId: req.schoolId },
      select: { id: true, userId: true },
    });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    const updatedUser = await prisma.user.updateMany({
      where: { id: teacher.userId, schoolId: req.schoolId }, // extra tenant guard
      data: { isActive: false },
    });

    if (updatedUser.count === 0) {
      return res.status(404).json({ message: "Teacher user not found in this school" });
    }

    await logAudit({
      req,
      schoolId: req.schoolId,
      action: "TEACHER_DEACTIVATED",
      targetType: "TEACHER",
      targetId: teacher.id,
      metadata: { userId: teacher.userId },
    });

    return res.json({ message: "Teacher deactivated", ok: true });
  } catch (err) {
    console.error("DEACTIVATE TEACHER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// ADMIN: Activate teacher (re-enables the user account) (tenant scoped)
// -----------------------------
router.patch("/:id/activate", requireRole("ADMIN"), async (req, res) => {
  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id: String(req.params.id), schoolId: req.schoolId },
      select: { id: true, userId: true },
    });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    const updatedUser = await prisma.user.updateMany({
      where: { id: teacher.userId, schoolId: req.schoolId }, // extra tenant guard
      data: { isActive: true },
    });

    if (updatedUser.count === 0) {
      return res.status(404).json({ message: "Teacher user not found in this school" });
    }

    await logAudit({
      req,
      schoolId: req.schoolId,
      action: "TEACHER_ACTIVATED",
      targetType: "TEACHER",
      targetId: teacher.id,
      metadata: { userId: teacher.userId },
    });

    return res.json({ message: "Teacher activated", ok: true });
  } catch (err) {
    console.error("ACTIVATE TEACHER ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
