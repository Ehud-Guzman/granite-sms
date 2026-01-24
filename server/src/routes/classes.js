// src/routes/classes.js
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
const cleanStr = (v) => (v == null ? "" : String(v).trim());

const cleanNullable = (v) => {
  const s = cleanStr(v);
  return s.length ? s : null;
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

const isValidYear = (y) => Number.isInteger(y) && y >= 2000 && y <= 2100;

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.user?.role || req.role || null,
    actorEmail: req.userEmail || req.user?.email || null,
  };
}

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

    // Optional hard-scope: TEACHER sees only assigned classes
    // Flip this on once classTeacher assignments are reliable:
    /*
    if (req.role === "TEACHER") {
      const teacherId = req.user?.teacherId;
      if (!teacherId) return res.json([]);

      const assigned = await prisma.classTeacher.findMany({
        where: {
          schoolId,
          teacherId: String(teacherId),
          isActive: true,
        },
        select: { classId: true },
      });

      const classIds = assigned.map((x) => x.classId);
      if (classIds.length === 0) return res.json([]);

      where.id = { in: classIds };
    }
    */

    const classes = await prisma.class.findMany({
      where,
      orderBy: [{ year: "desc" }, { name: "asc" }, { stream: "asc" }],
    });

    return res.json(classes);
  } catch (err) {
    console.error("LIST CLASSES ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ADMIN + TEACHER: get one class (tenant scoped)
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
