// src/modules/exams/exams.routes.js
import { Router } from "express";
import * as ctrl from "./exams.controllers.js";

import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/entitlements.js";
import { tenantContext, requireTenant } from "../../middleware/tenant.js";

const router = Router();

/**
 * Exams Module
 * Base path: /api/exams
 *
 * Security model:
 * - All routes require auth.
 * - Read operations require EXAMS_READ entitlement.
 * - Write operations require EXAMS_WRITE entitlement.
 * - Roles:
 *   - ADMIN: read + write (subject to entitlement/subscription)
 *   - TEACHER: read, and limited writes (marksheets submit/marks)
 *   - Others: denied
 */


router.use(requireAuth);
router.use(tenantContext);
router.use(requireTenant);

// ------------------------
// Exam Types
// ------------------------
router.get(
  "/types",
  // Optional extra role gate (safe) — prevents weird roles relying on entitlement bugs
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_READ"),
  ctrl.listExamTypes
);

router.post(
  "/types",
  requireRole("ADMIN"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.createExamType
);

// ------------------------
// Exam Sessions
// ------------------------
router.get(
  "/sessions",
  // Optional extra role gate (recommended)
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_READ"),
  ctrl.listExamSessions
);

router.post(
  "/sessions",
  requireRole("ADMIN"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.createExamSession
);

// ------------------------
// MarkSheets
// ------------------------
router.get(
  "/marksheets/:id",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_READ"),
  ctrl.getMarkSheet
);

router.put(
  "/marksheets/:id/marks",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.upsertBulkMarks
);

router.post(
  "/marksheets/:id/submit",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.submitMarkSheet
);

router.post(
  "/marksheets/:id/unlock",
  requireRole("ADMIN"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.unlockMarkSheet
);

router.get(
  "/sessions/:id/marksheets",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_READ"),
  ctrl.listSessionMarkSheets
);

// ------------------------
// Publish results (ADMIN)
// ------------------------
router.post(
  "/sessions/:id/publish",
  requireRole("ADMIN"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.publishResults
);

// ------------------------
// Results read
// ------------------------
router.get(
  "/sessions/:id/results/class",
  requireRole("ADMIN", "TEACHER"),
  requireEntitlement("EXAMS_READ"),
  ctrl.getClassResults
);

router.get(
  "/sessions/:id/results/students/:studentId",
  requireRole("ADMIN", "TEACHER", "STUDENT"),
  requireEntitlement("EXAMS_READ"),
  ctrl.getStudentResults
);

export default router;
