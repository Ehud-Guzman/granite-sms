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
 * - classId + teacherId must belong to req.schoolId
 * - ClassTeacher records should be tenant-scoped (schoolId)
 */

// ADMIN: assign a class teacher (1 class -> 1 teacher)
router.post(
  "/",
  requireRole("ADMIN"),
  requireFeature("enableClassTeachers"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const { classId, teacherId } = req.body || {};

      if (!classId || !teacherId) {
        return res.status(400).json({ message: "classId and teacherId are required" });
      }

      // tenant-safe lookups
      const [c, t] = await Promise.all([
        prisma.class.findFirst({
          where: { id: String(classId), schoolId },
          select: { id: true, name: true, stream: true, year: true, schoolId: true },
        }),
        prisma.teacher.findFirst({
          where: { id: String(teacherId), schoolId },
          include: { user: { select: { email: true, isActive: true } } },
        }),
      ]);

      if (!c) return res.status(404).json({ message: "Class not found in this school" });
      if (!t) return res.status(404).json({ message: "Teacher not found in this school" });
      if (!t.user?.isActive) return res.status(400).json({ message: "Teacher user is deactivated" });

      // ✅ Use composite unique: (schoolId, classId)
      // Prisma composite key name is usually: schoolId_classId
      const created = await prisma.classTeacher.upsert({
        where: {
          schoolId_classId: {
            schoolId,
            classId: c.id,
          },
        },
        update: {
          teacherId: t.id,
          isActive: true,
        },
        create: {
          schoolId,
          classId: c.id,
          teacherId: t.id,
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

// ADMIN + TEACHER: list class teachers (tenant scoped)
router.get(
  "/",
  requireRole("ADMIN", "TEACHER"),
  requireFeature("enableClassTeachers"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;

      const rows = await prisma.classTeacher.findMany({
        where: {
          schoolId,
          isActive: true,
        },
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
