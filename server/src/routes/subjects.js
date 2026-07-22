import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/features.js";
import { requireTenant } from "../middleware/tenant.js";
import { cleanStr } from "../utils/validate.js";
import { logAudit, actorCtx } from "../utils/audit.js";

const router = Router();
router.use(requireTenant);

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

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "SUBJECT_CREATED",
        targetType: "SUBJECT",
        targetId: created.id,
        metadata: { name: created.name, code: created.code },
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
// Optional query param: active=true/false (default true) — mirrors classes.js
// /students.js. Without this, a deactivated subject could never be found again
// to reactivate via PATCH (create would just 409 on the still-unique name/code).
router.get(
  "/",
  requireRole("ADMIN", "TEACHER"),
  requireFeature("enableSubjectAssignments"),
  async (req, res) => {
    try {
      const activeParam = req.query.active;
      const active =
        activeParam === undefined ? true : String(activeParam).toLowerCase() === "true";

      const subjects = await prisma.subject.findMany({
        where: { schoolId: req.schoolId, isActive: active },
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

      // Same min-length requirement as create — PATCH previously let name be
      // set to "" or a single char, bypassing the check enforced on POST.
      if (name !== undefined && name.length < 2) {
        return res.status(400).json({ message: "name is required (min 2 chars)" });
      }

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

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "SUBJECT_UPDATED",
        targetType: "SUBJECT",
        targetId: updated.id,
        metadata: { name: updated.name, code: updated.code, isActive: updated.isActive },
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

      await logAudit({
        req,
        ...actorCtx(req),
        schoolId,
        action: "SUBJECT_DEACTIVATED",
        targetType: "SUBJECT",
        targetId: id,
        metadata: { isActive: false },
      });

      return res.json({ message: "Subject deactivated" });
    } catch (err) {
      console.error("DEACTIVATE SUBJECT ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
