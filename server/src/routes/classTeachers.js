// src/routes/classTeachers.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/features.js";
import { requireTenant } from "../middleware/tenant.js";

const router = Router();
router.use(requireTenant);

/**
 * CLASS TEACHERS
 * Base path: /api/class-teachers
 *
 * Tenant rules:
 * - classId must belong to req.schoolId
 * - teacherId can be:
 *    - Teacher.id (preferred)
 *    - Teacher.userId (user id linked to teacher profile)
 *    - User.id with role=TEACHER (legacy / UI sends this today)
 *
 * Behavior:
 * - If a TEACHER User exists but Teacher profile is missing, we auto-create the Teacher row.
 */

router.post(
  "/",
  requireRole("ADMIN"),
  requireFeature("enableClassTeachers"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const { classId, teacherId } = req.body || {};

      if (!classId || !teacherId) {
        return res.status(400).json({
          message: "classId and teacherId are required",
        });
      }

      // tenant-safe class lookup
      const c = await prisma.class.findFirst({
        where: { id: String(classId), schoolId },
        select: { id: true, name: true, stream: true, year: true, schoolId: true },
      });

      if (!c) {
        return res.status(404).json({ message: "Class not found in this school" });
      }

      // 1) Try resolve teacher by Teacher.id OR Teacher.userId
      let t = await prisma.teacher.findFirst({
        where: {
          schoolId,
          OR: [{ id: String(teacherId) }, { userId: String(teacherId) }],
        },
        include: { user: { select: { id: true, email: true, isActive: true, role: true } } },
      });

      // 2) ✅ Auto-heal: teacherId might actually be a TEACHER User.id (no Teacher profile yet)
      if (!t) {
        const u = await prisma.user.findFirst({
          where: {
            id: String(teacherId),
            schoolId,
            role: "TEACHER",
          },
          select: { id: true, email: true, isActive: true },
        });

        if (u) {
          // Create missing Teacher profile
          t = await prisma.teacher.create({
            data: {
              schoolId,
              userId: u.id,
              firstName: "", // optional placeholder
              lastName: "",
              phone: null,
            },
            include: { user: { select: { id: true, email: true, isActive: true, role: true } } },
          });
        }
      }

      if (!t) {
        return res.status(404).json({
          message:
            "Teacher not found in this school (expected Teacher.id, Teacher.userId, or a User.id with role=TEACHER)",
        });
      }

      if (!t.user?.isActive) {
        return res.status(400).json({ message: "Teacher user is deactivated" });
      }

      // ✅ Upsert (1 class -> 1 teacher) scoped by (schoolId, classId)
      const created = await prisma.classTeacher.upsert({
        where: {
          schoolId_classId: {
            schoolId,
            classId: c.id,
          },
        },
        update: {
          teacherId: t.id, // always store Teacher.id
          isActive: true,
        },
        create: {
          schoolId,
          classId: c.id,
          teacherId: t.id, // always store Teacher.id
          isActive: true,
        },
        include: {
          class: true,
          teacher: { include: { user: { select: { email: true, isActive: true } } } },
        },
      });

      return res.status(201).json(created);
    } catch (err) {
      console.error("ASSIGN CLASS TEACHER ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/",
  requireRole("ADMIN", "TEACHER"),
  requireFeature("enableClassTeachers"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;

      const rows = await prisma.classTeacher.findMany({
        where: { schoolId, isActive: true },
        include: {
          class: true,
          teacher: { include: { user: { select: { email: true, isActive: true } } } },
        },
        orderBy: { createdAt: "desc" },
      });

      return res.json(rows);
    } catch (err) {
      console.error("LIST CLASS TEACHERS ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
