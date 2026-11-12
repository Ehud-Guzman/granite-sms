// src/routes/fees/setup.routes.js
// Subscription, fee items and fee plans.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/subscription.js";
import { toInt } from "../../utils/validate.js";
import { feesAudit } from "./shared.js";

const router = Router();

/* --------------------------------------
 * Subscription (demo/admin setup endpoints)
 * -------------------------------------- */

router.get("/subscription", async (req, res) => {
  return res.json({
    schoolId: req.schoolId,
    subscription: req.subscription,
    mode: req.subscription ? "SUBSCRIBED" : "READ_ONLY",
  });
});

// SYSTEM_ADMIN only: this endpoint can set arbitrary entitlements/status/period
// on a school's subscription. It was previously ADMIN-gated ("demo setup"), which
// let any tenant ADMIN self-grant arbitrary entitlements (e.g. {"FEES_WRITE":true,
// "ANYTHING_ELSE":true}) and an ACTIVE status with any currentPeriodEnd, bypassing
// the SYSTEM_ADMIN-only /api/settings/subscription control plane entirely.
router.post("/subscription", requireRole("SYSTEM_ADMIN"), async (req, res) => {
  try {
    const {
      schoolName,
      schoolCode,
      status = "ACTIVE",
      entitlements = { FEES_WRITE: true, FEES_READ: true },
      currentPeriodEnd,
    } = req.body || {};

    if (!schoolName || String(schoolName).trim().length < 2) {
      return res.status(400).json({ message: "schoolName is required (min 2 chars)." });
    }

    const school = await prisma.school.upsert({
      where: { id: req.schoolId },
      update: {
        name: String(schoolName).trim(),
        code: schoolCode ? String(schoolCode).trim() : undefined,
      },
      create: {
        id: req.schoolId,
        name: String(schoolName).trim(),
        code: schoolCode ? String(schoolCode).trim() : null,
        isActive: true,
      },
    });

    const sub = await prisma.subscription.create({
      data: {
        schoolId: school.id,
        status,
        entitlements,
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
      },
    });

    await feesAudit(req, {
      action: "SUBSCRIPTION_CREATED",
      targetType: "SUBSCRIPTION",
      targetId: sub.id,
      metadata: { status, entitlements },
    });

    return res.status(201).json({ school, subscription: sub });
  } catch (err) {
    console.error("CREATE SUBSCRIPTION ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* --------------------
 * Fee Items (ADMIN-only)
 * -------------------- */

router.get("/items", requireRole("ADMIN"), async (req, res) => {
  const items = await prisma.feeItem.findMany({
    where: { schoolId: req.schoolId },
    orderBy: { createdAt: "desc" },
  });
  return res.json(items);
});

router.post(
  "/items",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { name, code } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: "name is required (min 2 chars)" });
    }

    try {
      const item = await prisma.feeItem.create({
        data: {
          schoolId: req.schoolId,
          name: String(name).trim(),
          code: code ? String(code).trim() : null,
        },
      });

      await feesAudit(req, {
        action: "FEES_ITEM_CREATED",
        targetType: "FEE_ITEM",
        targetId: item.id,
        metadata: { name: item.name, code: item.code },
      });

      return res.status(201).json(item);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Fee item already exists." });
      }
      console.error("CREATE FEE ITEM ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.patch(
  "/items/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;
    const { name, code, isActive } = req.body || {};

    const existing = await prisma.feeItem.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee item not found." });

    try {
      const updated = await prisma.feeItem.update({
        where: { id: String(id) },
        data: {
          name: name !== undefined ? String(name).trim() : undefined,
          code: code !== undefined ? (code ? String(code).trim() : null) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
      });

      await feesAudit(req, {
        action: "FEES_ITEM_UPDATED",
        targetType: "FEE_ITEM",
        targetId: id,
        metadata: { before: existing, after: updated },
      });

      return res.json(updated);
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "Update conflict (duplicate name/code?)" });
      }
      console.error("UPDATE FEE ITEM ERROR:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/items/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;

    const existing = await prisma.feeItem.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee item not found." });

const updated = await prisma.feeItem.updateMany({
  where: { id: String(id), schoolId: req.schoolId },
  data: { isActive: false },
});

if (updated.count === 0) {
  return res.status(404).json({ message: "Fee item not found." });
}


    await feesAudit(req, {
      action: "FEES_ITEM_DEACTIVATED",
      targetType: "FEE_ITEM",
      targetId: id,
    });

    return res.json({ message: "Fee item deactivated." });
  }
);

/* --------------------
 * Fee Plans (ADMIN-only)
 * -------------------- */

router.get("/plans", requireRole("ADMIN"), async (req, res) => {
  const classId = req.query?.classId ? String(req.query.classId) : null;
  const year = toInt(req.query?.year, null);
  const term = req.query?.term ? String(req.query.term) : null;
  const includeInactive = String(req.query?.includeInactive || "") === "1";

  const plans = await prisma.feePlan.findMany({
    where: {
      schoolId: req.schoolId,
      classId: classId || undefined,
      year: year ?? undefined,
      term: term || undefined,
      isActive: includeInactive ? undefined : true,
    },
    include: { items: { include: { feeItem: true } } },
    orderBy: { createdAt: "desc" },
  });

  return res.json(plans);
});

router.post(
  "/plans",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { classId, year, term, title, items } = req.body || {};

    const y = toInt(year, null);
    if (!classId || !y || !term) {
      return res.status(400).json({ message: "classId, year, term are required." });
    }
    if (!Array.isArray(items) || items.length < 1) {
      return res.status(400).json({ message: "items[] is required (min 1)." });
    }

    const classRow = await prisma.class.findFirst({
      where: { id: String(classId), schoolId: req.schoolId },
      select: { id: true },
    });
    if (!classRow) return res.status(400).json({ message: "Invalid classId" });

    const feeItemIds = items.map((it) => String(it.feeItemId));
    const validItems = await prisma.feeItem.findMany({
      where: { id: { in: feeItemIds }, schoolId: req.schoolId, isActive: true },
      select: { id: true },
    });
    const validSet = new Set(validItems.map((x) => x.id));
    const bad = feeItemIds.filter((id) => !validSet.has(id));
    if (bad.length) {
      return res.status(400).json({ message: `Invalid feeItemId(s): ${bad.join(", ")}` });
    }

    // FeePlanItem.amount is a required, non-nullable integer column that feeds
    // directly into invoice totals — reject negative/fractional amounts up front
    // instead of letting a bad plan silently produce a negative or wrong invoice total.
    for (const it of items) {
      const amt = Number(it.amount);
      if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt < 0) {
        return res.status(400).json({
          message: "Each item.amount must be a non-negative whole number.",
        });
      }
    }

    try {
      const plan = await prisma.feePlan.create({
        data: {
          schoolId: req.schoolId,
          classId: String(classId),
          year: y,
          term: String(term),
          title: title ? String(title) : null,
          items: {
            create: items.map((it) => ({
              feeItemId: String(it.feeItemId),
              amount: Number(it.amount),
              required: it.required !== undefined ? Boolean(it.required) : true,
            })),
          },
        },
        include: { items: { include: { feeItem: true } } },
      });

      await feesAudit(req, {
        action: "FEES_PLAN_CREATED",
        targetType: "FEE_PLAN",
        targetId: plan.id,
        metadata: { classId, year: y, term, items: plan.items.length },
      });

      return res.status(201).json(plan);
    } catch (err) {
      console.error("CREATE PLAN ERROR:", err);
      return res.status(409).json({
        message: "Plan already exists for class/year/term OR invalid input.",
      });
    }
  }
);

router.patch(
  "/plans/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;
    const { title, isActive, items } = req.body || {};

    const existing = await prisma.feePlan.findFirst({
      where: { id: String(id), schoolId: req.schoolId },
    });
    if (!existing) return res.status(404).json({ message: "Fee plan not found." });

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length < 1) {
        return res.status(400).json({ message: "items[] must be a non-empty array." });
      }

      const feeItemIds = items.map((it) => String(it.feeItemId));
      if (new Set(feeItemIds).size !== feeItemIds.length) {
        return res.status(400).json({ message: "Duplicate feeItemId in items[]." });
      }

      const validItems = await prisma.feeItem.findMany({
        where: { id: { in: feeItemIds }, schoolId: req.schoolId, isActive: true },
        select: { id: true },
      });
      const validSet = new Set(validItems.map((x) => x.id));
      const bad = feeItemIds.filter((fid) => !validSet.has(fid));
      if (bad.length) {
        return res.status(400).json({ message: `Invalid feeItemId(s): ${bad.join(", ")}` });
      }

      // Same guard as plan creation: reject negative/fractional amounts before
      // they end up baked into a replacement set of invoice line items.
      for (const it of items) {
        const amt = Number(it.amount);
        if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt < 0) {
          return res.status(400).json({
            message: "Each item.amount must be a non-negative whole number.",
          });
        }
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (items !== undefined) {
          await tx.feePlanItem.deleteMany({ where: { feePlanId: existing.id } });
        }

        return tx.feePlan.update({
          where: { id: existing.id },
          data: {
            title: title !== undefined ? (title ? String(title) : null) : undefined,
            isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            items:
              items !== undefined
                ? {
                    create: items.map((it) => ({
                      feeItemId: String(it.feeItemId),
                      amount: Number(it.amount),
                      required: it.required !== undefined ? Boolean(it.required) : true,
                    })),
                  }
                : undefined,
          },
          include: { items: { include: { feeItem: true } } },
        });
      });

      await feesAudit(req, {
        action: "FEES_PLAN_UPDATED",
        targetType: "FEE_PLAN",
        targetId: id,
        metadata: { before: existing, itemsReplaced: items !== undefined },
      });

      return res.json(updated);
    } catch (err) {
      console.error("UPDATE PLAN ERROR:", err);
      return res.status(409).json({ message: "Update failed (duplicate fee item?)" });
    }
  }
);

router.delete(
  "/plans/:id",
  requireRole("ADMIN"),
  requireEntitlement("FEES_WRITE"),
  async (req, res) => {
    const { id } = req.params;

    const updated = await prisma.feePlan.updateMany({
      where: { id: String(id), schoolId: req.schoolId },
      data: { isActive: false },
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "Fee plan not found." });
    }

    await feesAudit(req, {
      action: "FEES_PLAN_DEACTIVATED",
      targetType: "FEE_PLAN",
      targetId: id,
    });

    return res.json({ message: "Fee plan deactivated." });
  }
);

export default router;
