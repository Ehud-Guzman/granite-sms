import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/features.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// ADMIN: create assignment
router.post(
  "/",
  requireRole("ADMIN"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const { teacherId, classId, subjectId } = req.body || {};

      if (!teacherId || !classId || !subjectId) {
        return res.status(400).json({ message: "teacherId, classId, subjectId are required" });
      }

      // Ensure all exist (tenant safe)
      const [t, c, s] = await Promise.all([
        prisma.teacher.findFirst({
          where: { id: String(teacherId), schoolId },
          include: { user: true },
        }),
        prisma.class.findFirst({
          where: { id: String(classId), schoolId },
        }),
        prisma.subject.findFirst({
          where: { id: String(subjectId), schoolId },
        }),
      ]);

      if (!t) return res.status(404).json({ message: "Teacher not found in this school" });
      if (!t.user?.isActive) return res.status(400).json({ message: "Teacher user is deactivated" });
      if (!c) return res.status(404).json({ message: "Class not found in this school" });
      if (!s) return res.status(404).json({ message: "Subject not found in this school" });

      // Upsert (not create): the compound unique constraint is on
      // (schoolId, teacherId, classId, subjectId) regardless of isActive, so a
      // plain create() would throw P2002 forever once an assignment had been
      // deactivated — there'd be no way to re-assign the same combo. Mirrors
      // the same fix already applied to classTeachers.js.
      const created = await prisma.teachingAssignment.upsert({
        where: {
          schoolId_teacherId_classId_subjectId: {
            schoolId,
            teacherId: String(teacherId),
            classId: String(classId),
            subjectId: String(subjectId),
          },
        },
        update: { isActive: true },
        create: {
          schoolId,
          teacherId: String(teacherId),
          classId: String(classId),
          subjectId: String(subjectId),
          isActive: true,
        },
        include: { teacher: true, class: true, subject: true },
      });

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "ASSIGNMENT_CREATED",
        targetType: "TEACHING_ASSIGNMENT",
        targetId: created.id,
        metadata: {
          teacherId: created.teacherId,
          classId: created.classId,
          subjectId: created.subjectId,
        },
      });

      return res.status(201).json(created);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Assignment already exists" });
      }
      console.error("CREATE ASSIGNMENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN + TEACHER: list assignments (filters supported)
router.get(
  "/",
  requireRole("ADMIN", "TEACHER"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const { teacherId, classId, subjectId } = req.query || {};

      const assignments = await prisma.teachingAssignment.findMany({
        where: {
          schoolId,
          isActive: true,
          ...(teacherId ? { teacherId: String(teacherId) } : {}),
          ...(classId ? { classId: String(classId) } : {}),
          ...(subjectId ? { subjectId: String(subjectId) } : {}),
        },
        include: {
          teacher: { include: { user: { select: { email: true, isActive: true } } } },
          class: true,
          subject: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return res.json(assignments);
    } catch (err) {
      console.error("LIST ASSIGNMENTS ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN: deactivate assignment (soft delete, tenant scoped)
router.patch(
  "/:id/deactivate",
  requireRole("ADMIN"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const id = String(req.params.id);

      const result = await prisma.teachingAssignment.updateMany({
        where: { id, schoolId },
        data: { isActive: false },
      });

      if (result.count === 0) return res.status(404).json({ message: "Assignment not found" });

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "ASSIGNMENT_DEACTIVATED",
        targetType: "TEACHING_ASSIGNMENT",
        targetId: id,
        metadata: { isActive: false },
      });

      return res.json({ message: "Assignment deactivated" });
    } catch (err) {
      console.error("DEACTIVATE ASSIGNMENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
