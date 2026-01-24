// src/routes/students.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, requireLimit } from "../middleware/subscription.js";
import { logAudit } from "../utils/audit.js";

const router = Router();
router.use(requireTenant);
router.use(loadSubscription);

// --------------------
// Helpers
// --------------------
const toDateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const cleanStr = (v) => (v == null ? null : String(v).trim());

const pickStudentUpdate = (body) => {
  const allowed = [
    "admissionNo",
    "firstName",
    "lastName",
    "gender",
    "dob",
    "classId",
    "isActive",
  ];
  const data = {};

  for (const k of allowed) data[k] = body?.[k];

  if ("admissionNo" in data && data.admissionNo != null)
    data.admissionNo = String(data.admissionNo).trim();
  if ("firstName" in data && data.firstName != null)
    data.firstName = String(data.firstName).trim();
  if ("lastName" in data && data.lastName != null)
    data.lastName = String(data.lastName).trim();
  if ("gender" in data && data.gender != null)
    data.gender = String(data.gender).trim();
  if ("classId" in data && data.classId != null)
    data.classId = String(data.classId).trim();
  if ("dob" in data) data.dob = toDateOrNull(data.dob);

  // Normalize empties → null
  if ("gender" in data && data.gender === "") data.gender = null;
  if ("classId" in data && data.classId === "") data.classId = null;

  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  return data;
};

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.user?.role || req.role || null,
    actorEmail: req.userEmail || req.user?.email || null,
  };
}

// --------------------
// STUDENTS
// Base path: /api/students
// --------------------

// ADMIN: Create student (ACTIVE count limit enforced)
router.post(
  "/",
  requireRole("ADMIN"),
  requireLimit("students"), // must count isActive=true internally
  async (req, res) => {
    try {
      const schoolId = req.schoolId;

      const admissionNo = cleanStr(req.body?.admissionNo);
      const firstName = cleanStr(req.body?.firstName);
      const lastName = cleanStr(req.body?.lastName);
      const gender = cleanStr(req.body?.gender);
      const dob = req.body?.dob ? toDateOrNull(req.body.dob) : null;
      const classId = req.body?.classId
        ? String(req.body.classId).trim()
        : null;

      if (!admissionNo || !firstName || !lastName) {
        return res
          .status(400)
          .json({ message: "admissionNo, firstName, lastName are required" });
      }

      // Validate class belongs to school (if provided)
      let classRow = null;
      if (classId) {
        classRow = await prisma.class.findFirst({
          where: { id: classId, schoolId },
          select: { id: true },
        });
        if (!classRow)
          return res
            .status(400)
            .json({ message: "Invalid classId for this school" });
      }

      const created = await prisma.student.create({
        data: {
          schoolId,
          admissionNo,
          firstName,
          lastName,
          gender: gender || null,
          dob,
          classId: classRow ? classRow.id : null,
          isActive: true,
        },
        include: { class: true },
      });

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "STUDENT_CREATED",
        targetType: "STUDENT",
        targetId: created.id,
        metadata: {
          admissionNo: created.admissionNo,
          name: `${created.firstName} ${created.lastName}`.trim(),
          classId: created.classId || null,
        },
      });

      return res.status(201).json(created);
    } catch (err) {
      if (err?.code === "P2002") {
        return res
          .status(409)
          .json({ message: "Admission number already exists in this school" });
      }
      console.error("CREATE STUDENT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN + TEACHER: Lookup student by admissionNo (ACTIVE only)
router.get("/lookup", requireRole("ADMIN", "TEACHER", "BURSAR"), async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const admissionNo = String(req.query.admissionNo || "").trim();
    if (!admissionNo)
      return res.status(400).json({ message: "admissionNo is required" });

    const student = await prisma.student.findFirst({
      where: { schoolId, admissionNo, isActive: true },
      include: { class: true },
    });

    if (!student)
      return res.status(404).json({ message: "Student not found" });

    // TEACHER scope: only students in assigned class(es)
    if (req.role === "TEACHER") {
      const teacherId = req.user?.teacherId;
      if (!teacherId) return res.status(403).json({ message: "Forbidden" });

      const isAssigned = await prisma.classTeacher.findFirst({
        where: {
          teacherId: String(teacherId),
          isActive: true,
          classId: student.classId ?? "__none__",
          class: { schoolId },
          teacher: { schoolId },
        },
        select: { id: true },
      });

      if (!isAssigned)
        return res
          .status(403)
          .json({ message: "Forbidden: not your assigned class" });
    }

    return res.json({ student });
  } catch (err) {
    console.error("LOOKUP STUDENT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN + TEACHER: List students (ACTIVE by default)
router.get("/", requireRole("ADMIN", "TEACHER", "BURSAR"), async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const activeParam = req.query.active;
    const active =
      activeParam === undefined
        ? true
        : String(activeParam).toLowerCase() === "true";

    const classIdFilter = req.query.classId
      ? String(req.query.classId).trim()
      : null;

    // Validate class belongs to school
    if (classIdFilter) {
      const classOk = await prisma.class.findFirst({
        where: { id: classIdFilter, schoolId },
        select: { id: true },
      });
      if (!classOk)
        return res
          .status(400)
          .json({ message: "Invalid classId for this school" });
    }

    const where = {
      schoolId,
      isActive: active,
      ...(classIdFilter ? { classId: classIdFilter } : {}),
    };

    // TEACHER scope enforcement
    if (req.role === "TEACHER") {
      const teacherId = req.user?.teacherId;
      if (!teacherId) return res.json([]);

      const assigned = await prisma.classTeacher.findMany({
        where: {
          teacherId: String(teacherId),
          isActive: true,
          class: { schoolId },
          teacher: { schoolId },
        },
        select: { classId: true },
      });

      const allowedClassIds = assigned.map((x) => x.classId);
      if (allowedClassIds.length === 0) return res.json([]);

      if (where.classId && !allowedClassIds.includes(where.classId)) {
        return res
          .status(403)
          .json({ message: "Forbidden: not your assigned class" });
      }

      if (!where.classId) where.classId = { in: allowedClassIds };
    }

    const students = await prisma.student.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { class: true },
    });

    return res.json(students);
  } catch (err) {
    console.error("LIST STUDENTS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN + TEACHER: Get one student
router.get("/:id", requireRole("ADMIN", "TEACHER", "BURSAR"), async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const student = await prisma.student.findFirst({
      where: { id: String(req.params.id), schoolId },
      include: { class: true },
    });

    if (!student)
      return res.status(404).json({ message: "Student not found" });

    if (req.role === "TEACHER") {
      const teacherId = req.user?.teacherId;
      if (!teacherId) return res.status(403).json({ message: "Forbidden" });

      const isAssigned = await prisma.classTeacher.findFirst({
        where: {
          teacherId: String(teacherId),
          isActive: true,
          classId: student.classId ?? "__none__",
          class: { schoolId },
          teacher: { schoolId },
        },
        select: { id: true },
      });

      if (!isAssigned) return res.status(403).json({ message: "Forbidden" });
    }

    return res.json(student);
  } catch (err) {
    console.error("GET STUDENT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: Update student
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const data = pickStudentUpdate(req.body);

    if ("classId" in data) {
      if (data.classId) {
        const classRow = await prisma.class.findFirst({
          where: { id: String(data.classId), schoolId },
          select: { id: true },
        });
        if (!classRow)
          return res
            .status(400)
            .json({ message: "Invalid classId for this school" });
      } else {
        data.classId = null;
      }
    }

    const before = await prisma.student.findFirst({
      where: { id: String(req.params.id), schoolId },
    });
    if (!before)
      return res.status(404).json({ message: "Student not found" });

    await prisma.student.updateMany({
      where: { id: String(req.params.id), schoolId },
      data,
    });

    const updated = await prisma.student.findFirst({
      where: { id: String(req.params.id), schoolId },
      include: { class: true },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "STUDENT_UPDATED",
      targetType: "STUDENT",
      targetId: before.id,
      metadata: { from: before, to: updated },
    });

    return res.json(updated);
  } catch (err) {
    if (err?.code === "P2002") {
      return res
        .status(409)
        .json({ message: "Admission number already exists in this school" });
    }
    console.error("UPDATE STUDENT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: Deactivate student (frees slot)
router.patch("/:id/deactivate", requireRole("ADMIN"), async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const before = await prisma.student.findFirst({
      where: { id: String(req.params.id), schoolId },
    });
    if (!before)
      return res.status(404).json({ message: "Student not found" });

    await prisma.student.updateMany({
      where: { id: String(req.params.id), schoolId },
      data: { isActive: false },
    });

    const updated = await prisma.student.findFirst({
      where: { id: String(req.params.id), schoolId },
      include: { class: true },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "STUDENT_DEACTIVATED",
      targetType: "STUDENT",
      targetId: before.id,
      metadata: { isActive: false },
    });

    return res.json({ message: "Student deactivated", student: updated });
  } catch (err) {
    console.error("DEACTIVATE STUDENT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
