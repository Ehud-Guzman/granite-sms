// src/routes/gradeScales.js
// Grading scales a school uses for results (audit H8). Base: /api/grade-scales
//
//   GET    /                ADMIN, TEACHER  scales, templates, default, class assignments
//   POST   /                ADMIN   create { template } or { name, overallBy, bands }
//   PUT    /:id             ADMIN   rename / change overall rule / replace bands
//   DELETE /:id             ADMIN   retire (classes using it fall back to the default)
//   PUT    /default         ADMIN   { gradeScaleId | null } school default
//   PUT    /assign          ADMIN   { classIds: [], gradeScaleId | null } per-class scale
//
// Results already published keep the grades they were published with.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { SCALE_TEMPLATES, validateBands } from "../modules/exams/exams.grades.js";

const router = Router();
router.use(requireTenant);

const scaleInclude = { bands: { orderBy: { minScore: "desc" } }, classes: { select: { id: true } } };
const out = (s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  overallBy: s.overallBy,
  bands: s.bands.map((b) => ({ label: b.label, minScore: b.minScore, maxScore: b.maxScore, points: b.points, remark: b.remark })),
  classIds: s.classes.map((c) => c.id),
});

function cleanBands(bands) {
  return bands.map((b) => ({
    label: String(b.label).trim(),
    minScore: Number(b.minScore),
    maxScore: Number(b.maxScore),
    points: b.points == null || b.points === "" ? null : Number(b.points),
    remark: b.remark ? String(b.remark).trim().slice(0, 60) : null,
  }));
}

router.get("/", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const [scales, settings] = await Promise.all([
    prisma.gradeScale.findMany({ where: { schoolId: req.schoolId, status: "ACTIVE" }, include: scaleInclude, orderBy: { name: "asc" } }),
    prisma.schoolSettings.findUnique({ where: { schoolId: req.schoolId }, select: { defaultGradeScaleId: true } }),
  ]);
  return res.json({
    scales: scales.map(out),
    defaultGradeScaleId: settings?.defaultGradeScaleId || null,
    templates: Object.entries(SCALE_TEMPLATES).map(([key, t]) => ({ key, ...t })),
  });
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const t = req.body?.template ? SCALE_TEMPLATES[String(req.body.template)] : null;
  if (req.body?.template && !t) return res.status(400).json({ message: "Unknown template" });
  const name = String(req.body?.name || t?.name || "").trim().slice(0, 60);
  const overallBy = String(req.body?.overallBy || t?.overallBy || "AVERAGE").toUpperCase();
  const bands = cleanBands(req.body?.bands || t?.bands || []);
  if (!name) return res.status(400).json({ message: "name is required" });
  if (!["AVERAGE", "POINTS"].includes(overallBy)) return res.status(400).json({ message: "overallBy must be AVERAGE or POINTS" });
  if (overallBy === "POINTS" && bands.some((b) => b.points == null)) {
    return res.status(400).json({ message: "Every band needs points when the overall grade uses points." });
  }
  const err = validateBands(bands);
  if (err) return res.status(400).json({ message: err });

  try {
    const scale = await prisma.gradeScale.create({
      data: {
        schoolId: req.schoolId,
        name,
        overallBy,
        bands: { create: bands.map((b) => ({ ...b, schoolId: req.schoolId })) },
      },
      include: scaleInclude,
    });
    await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "GRADE_SCALE_CREATED", targetType: "GRADE_SCALE", targetId: scale.id, metadata: { name, template: req.body?.template || null } });
    return res.status(201).json({ scale: out(scale) });
  } catch (e) {
    if (e?.code === "P2002") {
      // A retired scale with the same name: bring it back with these bands.
      const old = await prisma.gradeScale.findFirst({ where: { schoolId: req.schoolId, name } });
      if (old?.status === "INACTIVE") {
        const scale = await prisma.$transaction(async (tx) => {
          await tx.gradeBand.deleteMany({ where: { gradeScaleId: old.id } });
          return tx.gradeScale.update({
            where: { id: old.id },
            data: { status: "ACTIVE", overallBy, bands: { create: bands.map((b) => ({ ...b, schoolId: req.schoolId })) } },
            include: scaleInclude,
          });
        });
        return res.status(201).json({ scale: out(scale) });
      }
      return res.status(409).json({ message: "A scale with that name already exists." });
    }
    throw e;
  }
});

router.put("/default", requireRole("ADMIN"), async (req, res) => {
  const id = req.body?.gradeScaleId ? String(req.body.gradeScaleId) : null;
  if (id && !(await prisma.gradeScale.findFirst({ where: { id, schoolId: req.schoolId, status: "ACTIVE" } }))) {
    return res.status(404).json({ message: "Scale not found" });
  }
  await prisma.schoolSettings.upsert({
    where: { schoolId: req.schoolId },
    update: { defaultGradeScaleId: id },
    create: { schoolId: req.schoolId, defaultGradeScaleId: id },
  });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "GRADE_SCALE_DEFAULT_SET", targetType: "SCHOOL_SETTINGS", targetId: req.schoolId, metadata: { gradeScaleId: id } });
  return res.json({ defaultGradeScaleId: id });
});

router.put("/assign", requireRole("ADMIN"), async (req, res) => {
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map(String) : [];
  const id = req.body?.gradeScaleId ? String(req.body.gradeScaleId) : null;
  if (!classIds.length) return res.status(400).json({ message: "classIds[] is required" });
  if (id && !(await prisma.gradeScale.findFirst({ where: { id, schoolId: req.schoolId, status: "ACTIVE" } }))) {
    return res.status(404).json({ message: "Scale not found" });
  }
  const r = await prisma.class.updateMany({ where: { schoolId: req.schoolId, id: { in: classIds } }, data: { gradeScaleId: id } });
  if (r.count !== classIds.length) return res.status(400).json({ message: "Some classes were not found in this school." });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "GRADE_SCALE_ASSIGNED", targetType: "GRADE_SCALE", targetId: id, metadata: { classIds } });
  return res.json({ updated: r.count });
});

router.put("/:id", requireRole("ADMIN"), async (req, res) => {
  const scale = await prisma.gradeScale.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId, status: "ACTIVE" }, include: { bands: true } });
  if (!scale) return res.status(404).json({ message: "Scale not found" });

  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) : scale.name;
  const overallBy = req.body?.overallBy !== undefined ? String(req.body.overallBy).toUpperCase() : scale.overallBy;
  const bands = req.body?.bands !== undefined ? cleanBands(req.body.bands) : scale.bands;
  if (!name) return res.status(400).json({ message: "name is required" });
  if (!["AVERAGE", "POINTS"].includes(overallBy)) return res.status(400).json({ message: "overallBy must be AVERAGE or POINTS" });
  if (overallBy === "POINTS" && bands.some((b) => b.points == null)) {
    return res.status(400).json({ message: "Every band needs points when the overall grade uses points." });
  }
  const err = validateBands(bands);
  if (err) return res.status(400).json({ message: err });

  const updated = await prisma.$transaction(async (tx) => {
    if (req.body?.bands !== undefined) {
      await tx.gradeBand.deleteMany({ where: { gradeScaleId: scale.id } });
      await tx.gradeBand.createMany({ data: bands.map((b) => ({ ...b, schoolId: req.schoolId, gradeScaleId: scale.id })) });
    }
    return tx.gradeScale.update({ where: { id: scale.id }, data: { name, overallBy }, include: scaleInclude });
  });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "GRADE_SCALE_UPDATED", targetType: "GRADE_SCALE", targetId: scale.id, metadata: { name, overallBy, bands: bands.length } });
  return res.json({ scale: out(updated) });
});

router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const scale = await prisma.gradeScale.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId } });
  if (!scale) return res.status(404).json({ message: "Scale not found" });
  await prisma.$transaction([
    prisma.gradeScale.update({ where: { id: scale.id }, data: { status: "INACTIVE" } }),
    prisma.class.updateMany({ where: { schoolId: req.schoolId, gradeScaleId: scale.id }, data: { gradeScaleId: null } }),
    prisma.schoolSettings.updateMany({ where: { schoolId: req.schoolId, defaultGradeScaleId: scale.id }, data: { defaultGradeScaleId: null } }),
  ]);
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "GRADE_SCALE_RETIRED", targetType: "GRADE_SCALE", targetId: scale.id });
  return res.json({ ok: true });
});

export default router;
