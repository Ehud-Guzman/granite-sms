import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { loadSubscription } from "../../middleware/subscription.js"; // only if you use it globally

import { getSummary, getActivity } from "./dashboard.controller.js";

const router = Router();

router.use(requireAuth);
// router.use(loadSubscription); // optional, only if your app expects subscription context

router.get("/summary", requireRole("ADMIN", "TEACHER", "SYSTEM_ADMIN"), getSummary);
router.get("/activity", requireRole("ADMIN", "TEACHER", "SYSTEM_ADMIN"), getActivity);

export default router;
