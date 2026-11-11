import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { tenantContext, requireTenant } from "../../middleware/tenant.js";
import { loadSubscription } from "../../middleware/subscription.js"; // only if you use it globally

import { getSummary, getActivity } from "./dashboard.controller.js";

const router = Router();

router.use(requireAuth, tenantContext, requireTenant);
// router.use(loadSubscription); // optional, only if your app expects subscription context

// BURSAR is included so the bursar's dashboard shows fees figures instead of
// failing; the activity feed already limits what each role sees.
router.get("/summary", requireRole("ADMIN", "TEACHER", "BURSAR", "SYSTEM_ADMIN"), getSummary);
router.get("/activity", requireRole("ADMIN", "TEACHER", "BURSAR", "SYSTEM_ADMIN"), getActivity);

export default router;
