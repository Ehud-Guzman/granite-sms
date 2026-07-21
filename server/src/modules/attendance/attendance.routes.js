// src/modules/attendance/attendance.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { tenantContext, requireTenant } from "../../middleware/tenant.js";
import { loadSubscription, requireEntitlement, requireEntitlementRead } from "../../middleware/subscription.js";

import {
  createOrOpenSession,
  getSession,
  list,
  updateRecords,
  submit,
  unlock,
  lock,
  studentSummary,
  classSummary,
  defaultersList,
} from "./attendance.controller.js";

const router = Router();

// Must be authenticated + DB-verified tenant context (active user, active school).
// tenantContext sets req.schoolId (DB truth); requireTenant enforces its presence.
router.use(requireAuth, tenantContext, requireTenant);
router.use(loadSubscription);

// READ endpoints (allow ADMIN/TEACHER)
router.get("/sessions", requireRole("ADMIN", "TEACHER"), list);
router.get("/sessions/:id", requireRole("ADMIN", "TEACHER"), getSession);

router.get("/summary/student/:studentId", requireRole("ADMIN", "TEACHER"), studentSummary);
router.get(
  "/summary/class/:classId",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlementRead("ATTENDANCE_READ"),
  classSummary
);
router.get(
  "/defaulters",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlementRead("ATTENDANCE_READ"),
  defaultersList
);

// WRITE endpoints (subscription + role)
router.post(
  "/sessions",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("ATTENDANCE_WRITE"),
  createOrOpenSession
);

router.put(
  "/sessions/:id/records",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("ATTENDANCE_WRITE"),
  updateRecords
);

router.post(
  "/sessions/:id/submit",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("ATTENDANCE_WRITE"),
  submit
);

// ADMIN-only controls
router.post("/sessions/:id/unlock", requireRole("ADMIN"), requireEntitlement("ATTENDANCE_WRITE"), unlock);
router.post("/sessions/:id/lock", requireRole("ADMIN"), requireEntitlement("ATTENDANCE_WRITE"), lock);

export default router;
