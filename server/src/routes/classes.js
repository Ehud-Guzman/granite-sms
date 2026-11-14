// src/routes/classes.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, requireLimit, effectiveCap, capHit } from "../middleware/subscription.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { cleanStr, toInt } from "../utils/validate.js";

const router = Router();
router.use(requireTenant);
router.use(loadSubscription);

// --------------------
// Helpers
// --------------------
const cleanNullable = (v) => {
  const s = cleanStr(v);
  return s.length ? s : null;
};

const isValidYear = (y) => Number.isInteger(y) && y >= 2000 && y <= 2100;

function pickClassAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    stream: row.stream ?? null,
    year: row.year,
    isActive: Boolean(row.isActive),
  };
}

function buildDiff(from, to) {
  const diff = {};
  if (!from || !to) return diff;

  for (const k of Object.keys(to)) {
    // only compare known fields (avoid dumping entire prisma objects)
    if (["id", "name", "stream", "year", "isActive"].includes(k)) {
      if (from[k] !== to[k]) diff[k] = { from: from[k], to: to[k] };
    }
  }
  return diff;
}

// --------------------
// CLASSES
// Base path: /api/classes
// --------------------

// ADMIN: create class (CAP enforced)
router.post("/", requireRole("ADMIN"), requireLimit("classes"), async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const name = cleanStr(req.body?.name);
    const stream = cleanNullable(req.body?.stream);
    const year = toInt(req.body?.year);

    if (!name) return res.status(400).json({ message: "name is required" });
    if (Number.isNaN(year) || !isValidYear(year)) {
      return res.status(400).json({ message: "year must be a valid number (e.g. 2026)" });
    }

    const created = await prisma.class.create({
      data: {
        schoolId,
        name,
        stream,
        year,
        isActive: true,
      },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "CLASS_CREATED",
      targetType: "CLASS",
      targetId: created.id,
      metadata: pickClassAudit(created),
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Class already exists for that name/stream/year" });
    }
    console.error("CREATE CLASS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN + TEACHER: list classes
// Optional query params: year=2026, active=true/false (default true)
router.get("/", requireRole("ADMIN", "TEACHER", "BURSAR"), async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const yearParam = req.query.year;
    const year = yearParam !== undefined ? toInt(yearParam) : null;

    const activeParam = req.query.active;
    const active = activeParam === undefined ? true : String(activeParam).toLowerCase() === "true";

    const where = { schoolId, isActive: active };

    if (yearParam !== undefined) {
      if (Number.isNaN(year) || !isValidYear(year)) {
        return res.status(400).json({ message: "year must be a valid number (e.g. 2026)" });
      }
      where.year = year;
    }

    // A teacher sees only the classes they teach: their class-teacher class
    // and any class they have a subject in.
    if (req.role === "TEACHER") {
      const teacherId = req.user?.teacherId;
      if (!teacherId) return res.json([]);
      const [ct, ta] = await Promise.all([
        prisma.classTeacher.findMany({ where: { schoolId, teacherId: String(teacherId), isActive: true }, select: { classId: true } }),
        prisma.teachingAssignment.findMany({ where: { schoolId, teacherId: String(teacherId), isActive: true }, select: { classId: true } }),
      ]);
      const classIds = [...new Set([...ct, ...ta].map((x) => x.classId))];
      if (classIds.length === 0) return res.json([]);
      where.id = { in: classIds };
    }

    const classes = await prisma.class.findMany({
      where,
      orderBy: [{ year: "desc" }, { name: "asc" }, { stream: "asc" }],
      include: { _count: { select: { students: true } } },
    });

    return res.json(classes);
  } catch (err) {
    console.error("LIST CLASSES ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN + TEACHER: get one class (tenant scoped)
/**
 * POST /api/classes/promote  (ADMIN)
 * End-of-year promotion in one step.
 * Body: {
 *   moves: [{ fromClassId, toClassId }],   // toClassId null = the class graduates (leaves)
 *   exitDate?: "YYYY-MM-DD",               // for graduates; default today
 *   dryRun?: true                          // count only, change nothing
 * }
 * Moves every ACTIVE learner in each "from" class. All moves happen in one
 * transaction: either the whole promotion is applied or none of it.
 */
router.post("/promote", requireRole("ADMIN"), async (req, res) => {
  const schoolId = req.schoolId;
  const moves = Array.isArray(req.body?.moves) ? req.body.moves : null;
  const dryRun = req.body?.dryRun === true;
  if (!moves || moves.length === 0) return res.status(400).json({ message: "moves[] is required" });
  if (moves.length > 200) return res.status(400).json({ message: "Too many classes in one promotion (max 200)" });

  const exitDate = req.body?.exitDate ? new Date(`${req.body.exitDate}T00:00:00Z`) : new Date();
  if (Number.isNaN(exitDate.getTime())) return res.status(400).json({ message: "exitDate must be YYYY-MM-DD" });

  // Every class must belong to this school; a class can only be moved once.
  const fromIds = moves.map((m) => String(m?.fromClassId || ""));
  if (fromIds.some((id) => !id)) return res.status(400).json({ message: "Each move needs fromClassId" });
  if (new Set(fromIds).size !== fromIds.length) return res.status(400).json({ message: "A class appears twice as a source" });
  const toIds = moves.map((m) => (m?.toClassId ? String(m.toClassId) : null)).filter(Boolean);
  const classes = await prisma.class.findMany({
    where: { schoolId, id: { in: [...new Set([...fromIds, ...toIds])] } },
    select: { id: true, name: true, stream: true, year: true, isActive: true },
  });
  const byId = new Map(classes.map((c) => [c.id, c]));
  for (const m of moves) {
    const from = byId.get(String(m.fromClassId));
    if (!from) return res.status(400).json({ message: `Unknown class ${m.fromClassId}` });
    if (m.toClassId) {
      const to = byId.get(String(m.toClassId));
      if (!to) return res.status(400).json({ message: `Unknown class ${m.toClassId}` });
      if (to.id === from.id) return res.status(400).json({ message: `${from.name} can't be promoted into itself` });
      if (!to.isActive) return res.status(400).json({ message: `${to.name} ${to.stream || ""} (${to.year}) is inactive` });
      if (to.year < from.year) {
        return res.status(400).json({ message: `${from.name} (${from.year}) can't move back to a ${to.year} class` });
      }
    }
  }

  const counts = await prisma.student.groupBy({
    by: ["classId"],
    where: { schoolId, isActive: true, classId: { in: fromIds } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.classId, c._count._all]));
  const label = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})`;
  const summary = moves.map((m) => ({
    fromClassId: String(m.fromClassId),
    from: label(byId.get(String(m.fromClassId))),
    toClassId: m.toClassId ? String(m.toClassId) : null,
    to: m.toClassId ? label(byId.get(String(m.toClassId))) : "Graduated (leaves the school)",
    learners: countOf.get(String(m.fromClassId)) || 0,
  }));
  const totals = {
    moved: summary.filter((x) => x.toClassId).reduce((a, x) => a + x.learners, 0),
    graduated: summary.filter((x) => !x.toClassId).reduce((a, x) => a + x.learners, 0),
  };
  if (dryRun) return res.json({ dryRun: true, summary, totals });

  // Snapshot who is in each source class first, so a class that is both a
  // destination and a source (7E -> 8E while 8E -> 9E) moves the right people.
  const members = await prisma.student.findMany({
    where: { schoolId, isActive: true, classId: { in: fromIds } },
    select: { id: true, classId: true },
  });
  const idsByClass = new Map();
  for (const st of members) {
    if (!idsByClass.has(st.classId)) idsByClass.set(st.classId, []);
    idsByClass.get(st.classId).push(st.id);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const m of moves) {
        const ids = idsByClass.get(String(m.fromClassId)) || [];
        if (!ids.length) continue;
        await tx.student.updateMany({
          where: { schoolId, id: { in: ids } },
          data: m.toClassId
            ? { classId: String(m.toClassId) }
            : { isActive: false, exitStatus: "GRADUATED", exitDate, exitNote: `Graduated from ${label(byId.get(String(m.fromClassId)))}` },
        });
      }
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId,
    action: "STUDENTS_PROMOTED",
    targetType: "SCHOOL",
    targetId: schoolId,
    metadata: { summary, totals },
  });
  return res.json({ dryRun: false, summary, totals });
});

router.get("/:id", requireRole("ADMIN", "TEACHER", "BURSAR"), async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const id = String(req.params.id);

    const row = await prisma.class.findFirst({ where: { id, schoolId } });
    if (!row) return res.status(404).json({ message: "Class not found" });

    return res.json(row);
  } catch (err) {
    console.error("GET CLASS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: update class (tenant scoped update + no-op safe)
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const id = String(req.params.id);

    const beforeRow = await prisma.class.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, stream: true, year: true, isActive: true },
    });

    if (!beforeRow) return res.status(404).json({ message: "Class not found" });

    const data = {};

    // allowlist fields
    if ("name" in req.body) data.name = cleanStr(req.body.name);
    if ("stream" in req.body) data.stream = cleanNullable(req.body.stream);
    if ("year" in req.body) {
      const y = toInt(req.body.year);
      if (Number.isNaN(y) || !isValidYear(y)) {
        return res.status(400).json({ message: "year must be a valid number (e.g. 2026)" });
      }
      data.year = y;
    }
    if ("isActive" in req.body) data.isActive = Boolean(req.body.isActive);

    // validations
    if ("name" in data && !data.name) {
      return res.status(400).json({ message: "name cannot be empty" });
    }

    // Reactivation (isActive false -> true) bypasses requireLimit(), which only
    // ever runs on POST — enforce the same class cap here, mirroring the fix
    // already applied to Students.
    if (data.isActive === true && !beforeRow.isActive) {
      const cap = effectiveCap(req.subscription, "classes");
      const current = await prisma.class.count({
        where: { schoolId, isActive: true },
      });
      if (capHit(current, cap)) {
        return res.status(409).json({
          message: `Class limit reached (${current}/${cap}). Upgrade to reactivate more classes.`,
          code: "LIMIT_REACHED",
          resource: "classes",
          used: current,
          limit: cap,
        });
      }
    }

    // no-op protection
    const before = pickClassAudit(beforeRow);
    const candidate = { ...before, ...data };
    const diff = buildDiff(before, candidate);

    if (Object.keys(diff).length === 0) {
      return res.json(beforeRow); // nothing changed; do not write or audit
    }

    // ✅ tenant-scoped write
    const updatedCount = await prisma.class.updateMany({
      where: { id, schoolId },
      data,
    });

    if (updatedCount.count === 0) {
      return res.status(404).json({ message: "Class not found" });
    }

    const updatedRow = await prisma.class.findFirst({
      where: { id, schoolId },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "CLASS_UPDATED",
      targetType: "CLASS",
      targetId: id,
      metadata: {
        diff,
        from: before,
        to: pickClassAudit(updatedRow),
      },
    });

    return res.json(updatedRow);
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Class already exists for that name/stream/year" });
    }
    console.error("UPDATE CLASS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: deactivate class (soft delete, tenant scoped, idempotent)
router.patch("/:id/deactivate", requireRole("ADMIN"), async (req, res) => {
  try {
    const schoolId = req.schoolId;
    const id = String(req.params.id);

    const existing = await prisma.class.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, stream: true, year: true, isActive: true },
    });

    if (!existing) return res.status(404).json({ message: "Class not found" });

    if (!existing.isActive) {
      // idempotent: already deactivated
      return res.json({ message: "Class already deactivated" });
    }

    const updatedCount = await prisma.class.updateMany({
      where: { id, schoolId },
      data: { isActive: false },
    });

    if (updatedCount.count === 0) {
      return res.status(404).json({ message: "Class not found" });
    }

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId,
      action: "CLASS_DEACTIVATED",
      targetType: "CLASS",
      targetId: id,
      metadata: { isActive: false },
    });

    return res.json({ message: "Class deactivated" });
  } catch (err) {
    console.error("DEACTIVATE CLASS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
