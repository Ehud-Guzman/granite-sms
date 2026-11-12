import { Router } from "express";
import { requireRole } from "../../middleware/auth.js";
import { requireTenant } from "../../middleware/tenant.js";

import { getSummary, getActivity } from "./dashboard.controller.js";

const router = Router();

// requireAuth + tenantContext already run for every /api route (app.js).
router.use(requireTenant);

// BURSAR is included so the bursar's dashboard shows fees figures instead of
// failing; the activity feed already limits what each role sees.
router.get("/summary", requireRole("ADMIN", "TEACHER", "BURSAR", "SYSTEM_ADMIN"), getSummary);
router.get("/activity", requireRole("ADMIN", "TEACHER", "BURSAR", "SYSTEM_ADMIN"), getActivity);

export default router;
