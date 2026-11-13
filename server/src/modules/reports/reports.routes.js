import { Router } from "express";
import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/entitlements.js";
import { requireTenant } from "../../middleware/tenant.js";
import * as ctrl from "./reports.controllers.js";

const router = Router();

// requireAuth + tenantContext already run for every /api route (app.js).
router.use(requireTenant);

// Reports: ADMIN only for now (MVP)
router.get(
  "/class-performance",
  requireRole("ADMIN"),
  // simplest: tie reports read access to EXAMS_READ since it’s derived from exams
  requireEntitlement("EXAMS_READ"),
  ctrl.getClassPerformanceReport
);

export default router;
