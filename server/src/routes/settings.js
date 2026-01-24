// src/routes/settings.js
import { Router } from "express";

import featureRoutes from "./settings/features.routes.js";
import securityRoutes from "./settings/security.routes.js";
import auditRoutes from "./settings/audit.routes.js";
import subscriptionRoutes from "./settings/subscription.routes.js";
import backupRoutes from "./settings/backup.routes.js";

import schoolProfileRoutes from "./settings/school.routes.js";
import academicsRoutes from "./settings/academics.routes.js";
import brandingRoutes from "./settings/branding.routes.js";

import printRoutes from "./settings/print.routes.js";



const router = Router();

// Keep URLs stable:
// /api/settings
router.use("/", featureRoutes);

// /api/settings/security/* (includes /security and /security/overview)
router.use("/security", securityRoutes);

// /api/settings/audit-logs
router.use("/", auditRoutes);

// ✅ Phase B — School profile
// /api/settings/school
router.use("/school", schoolProfileRoutes);

// ✅ Phase B — Academic defaults
// /api/settings/academics
router.use("/academics", academicsRoutes);

// /api/settings/subscription/overview
router.use("/subscription", subscriptionRoutes);

// ✅ Phase A — Branding
// /api/settings/branding
router.use("/branding", brandingRoutes);

// ✅ Phase A — Print settings
// /api/settings/print
router.use("/print", printRoutes);

// /api/settings/backup/*
router.use("/backup", backupRoutes);

export default router;
