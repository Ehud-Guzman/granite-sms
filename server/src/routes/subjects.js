import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/features.js";
import { requireTenant } from "../middleware/tenant.js";

const router = Router();
router.use(requireTenant);

const cleanStr = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * SUBJECTS
 * Base path: /api/subjects
 * Tenant-scoped by req.schoolId
 */

// ADMIN: create subject
router.post(
  "/",
  requireRole("ADMIN"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;

      const name = cleanStr(req.body?.name);
      const codeRaw = req.body?.code;
      const code = codeRaw ? cleanStr(codeRaw) : null;

      if (!name || name.length < 2) {
        return res.status(400).json({ message: "name is required (min 2 chars)" });
      }

      const created = await prisma.subject.create({
        data: {
          schoolId,
          name,
          code: code || null,
          isActive: true,
        },
      });

      return res.status(201).json(created);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Subject name/code already exists in this school" });
      }
      console.error("CREATE SUBJECT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN + TEACHER: list subjects (tenant scoped)
router.get(
  "/",
  requireRole("ADMIN", "TEACHER"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const subjects = await prisma.subject.findMany({
        where: { schoolId: req.schoolId, isActive: true },
        orderBy: { name: "asc" },
      });
      return res.json(subjects);
    } catch (err) {
      console.error("LIST SUBJECTS ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN: update subject (tenant scoped)
router.patch(
  "/:id",
  requireRole("ADMIN"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const id = String(req.params.id);

      const name = req.body?.name !== undefined ? cleanStr(req.body?.name) : undefined;
      const code =
        req.body?.code !== undefined ? (req.body?.code ? cleanStr(req.body?.code) : null) : undefined;
      const isActive = req.body?.isActive !== undefined ? Boolean(req.body?.isActive) : undefined;

      // ensure exists in tenant
      const existing = await prisma.subject.findFirst({
        where: { id, schoolId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ message: "Subject not found" });

      const updated = await prisma.subject.update({
        where: { id: existing.id },
        data: {
          name,
          code,
          isActive,
        },
      });

      return res.json(updated);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Duplicate subject name/code in this school" });
      }
      console.error("UPDATE SUBJECT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// ADMIN: deactivate subject (soft delete)
router.patch(
  "/:id/deactivate",
  requireRole("ADMIN"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const schoolId = req.schoolId;
      const id = String(req.params.id);

      const result = await prisma.subject.updateMany({
        where: { id, schoolId },
        data: { isActive: false },
      });

      if (result.count === 0) return res.status(404).json({ message: "Subject not found" });

      return res.json({ message: "Subject deactivated" });
    } catch (err) {
      console.error("DEACTIVATE SUBJECT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
