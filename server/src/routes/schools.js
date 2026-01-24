// src/routes/schools.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";

const router = Router();

// -----------------------------
// Helpers
// -----------------------------
function cleanId(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function isValidId(id) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(id);
}

function cleanName(v) {
  return String(v || "").trim();
}

function actorCtx(req) {
  return {
    actorId: req.user?.id || null,
    actorRole: req.user?.role || "SYSTEM_ADMIN",
    actorEmail: null, // no tenantContext here
  };
}

// Plan defaults (Phase 1)
const PLAN_DEFAULTS = {
  FREE: { maxStudents: 50, maxTeachers: 10, maxClasses: 5, status: "TRIAL" },
  BASIC: { maxStudents: 300, maxTeachers: 30, maxClasses: 15, status: "ACTIVE" },
  PRO: { maxStudents: 1200, maxTeachers: 80, maxClasses: 40, status: "ACTIVE" },
  ENTERPRISE: { maxStudents: null, maxTeachers: null, maxClasses: null, status: "ACTIVE" },
};

function normalizePlan(planCode) {
  const p = String(planCode || "FREE").toUpperCase();
  return PLAN_DEFAULTS[p] ? p : "FREE";
}

// Ensures a school has at least one subscription.
// If one exists, returns it. If not, creates one using defaults.
async function ensureSubscription(tx, { schoolId, planCode = "FREE" }) {
  const existing = await tx.subscription.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      schoolId: true,
      planCode: true,
      status: true,
      maxStudents: true,
      maxTeachers: true,
      maxClasses: true,
      createdAt: true,
    },
  });

  if (existing) return { subscription: existing, created: false };

  const plan = normalizePlan(planCode);
  const d = PLAN_DEFAULTS[plan];

  const sub = await tx.subscription.create({
    data: {
      schoolId,
      planCode: plan,
      status: d.status, // TRIAL for FREE by default
      maxStudents: d.maxStudents,
      maxTeachers: d.maxTeachers,
      maxClasses: d.maxClasses,
      // startsAt is default(now()) in schema (if present)
    },
    select: {
      id: true,
      schoolId: true,
      planCode: true,
      status: true,
      maxStudents: true,
      maxTeachers: true,
      maxClasses: true,
      createdAt: true,
    },
  });

  return { subscription: sub, created: true };
}

/**
 * Base: /api/schools
 * SYSTEM_ADMIN only (platform control plane)
 *
 * IMPORTANT:
 * Do NOT use tenantContext here.
 * This router must work even when no school is selected OR the selected school is suspended.
 */
router.use(requireAuth, requireRole("SYSTEM_ADMIN"));

/**
 * GET /api/schools
 * List all schools (active + inactive)
 * (Optionally include subscription summary for convenience)
 */
router.get("/", async (req, res) => {
  try {
    const schools = await prisma.school.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, isActive: true, createdAt: true },
    });

    return res.json({ schools });
  } catch (err) {
    console.error("LIST SCHOOLS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/schools
 * Create school
 * body: { id, name, planCode? }
 */
router.post("/", async (req, res) => {
  try {
    const id = cleanId(req.body?.id);
    const name = cleanName(req.body?.name);
    const planCode = normalizePlan(req.body?.planCode); // optional

    if (!id || !name) {
      return res.status(400).json({ message: "id and name are required" });
    }
    if (!isValidId(id)) {
      return res.status(400).json({
        message: "Invalid school id. Use letters/numbers/_/- (3-40 chars).",
      });
    }
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ message: "Invalid school name length" });
    }

    const existing = await prisma.school.findUnique({ where: { id } });
    if (existing) {
      return res.status(409).json({ message: "School id already exists" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: { id, name, isActive: true },
        select: { id: true, name: true, isActive: true, createdAt: true },
      });

      // Auto-create default subscription
      const { subscription, created } = await ensureSubscription(tx, {
        schoolId: school.id,
        planCode,
      });

      return { school, subscription, subscriptionCreated: created };
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId: result.school.id,
      action: "SCHOOL_CREATED",
      targetType: "SCHOOL",
      targetId: result.school.id,
      metadata: { name: result.school.name },
    });

    if (result.subscriptionCreated) {
      await logAudit({
        req,
        ...actorCtx(req),
        schoolId: result.school.id,
        action: "SUBSCRIPTION_CREATED",
        targetType: "SUBSCRIPTION",
        targetId: result.subscription.id,
        metadata: {
          planCode: result.subscription.planCode,
          status: result.subscription.status,
          limits: {
            maxStudents: result.subscription.maxStudents,
            maxTeachers: result.subscription.maxTeachers,
            maxClasses: result.subscription.maxClasses,
          },
        },
      });
    }

    return res.status(201).json({
      school: result.school,
      subscription: result.subscription,
    });
  } catch (err) {
    console.error("CREATE SCHOOL ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/schools/:id
 * Update school name
 * body: { name }
 */
router.patch("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const name = cleanName(req.body?.name);

    if (!id) return res.status(400).json({ message: "id required" });
    if (!name) return res.status(400).json({ message: "name is required" });
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ message: "Invalid school name length" });
    }

    const before = await prisma.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!before) return res.status(404).json({ message: "School not found" });

    const school = await prisma.school.update({
      where: { id },
      data: { name },
      select: { id: true, name: true, isActive: true, createdAt: true },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId: school.id,
      action: "SCHOOL_UPDATED",
      targetType: "SCHOOL",
      targetId: school.id,
      metadata: { from: { name: before.name }, to: { name: school.name } },
    });

    return res.json({ school });
  } catch (err) {
    console.error("UPDATE SCHOOL ERROR:", err);
    if (err?.code === "P2025") {
      return res.status(404).json({ message: "School not found" });
    }
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/schools/:id/status
 * Suspend / activate
 * body: { isActive: boolean }
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const isActive = req.body?.isActive;

    if (!id) return res.status(400).json({ message: "id required" });
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be boolean" });
    }

    if (req.user?.schoolId === id && isActive === false) {
      return res.status(400).json({
        message: "Cannot suspend the currently selected school. Clear/switch context first.",
      });
    }

    const school = await prisma.school.update({
      where: { id },
      data: { isActive },
      select: { id: true, name: true, isActive: true, createdAt: true },
    });

    await logAudit({
      req,
      ...actorCtx(req),
      schoolId: school.id,
      action: isActive ? "SCHOOL_ACTIVATED" : "SCHOOL_SUSPENDED",
      targetType: "SCHOOL",
      targetId: school.id,
      metadata: { isActive },
    });

    return res.json({ school });
  } catch (err) {
    console.error("SCHOOL STATUS ERROR:", err);
    if (err?.code === "P2025") {
      return res.status(404).json({ message: "School not found" });
    }
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
