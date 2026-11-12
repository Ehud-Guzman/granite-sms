// src/modules/exams/exams.routes.js
import { Router } from "express";
import * as ctrl from "./exams.controllers.js";

import { requireRole } from "../../middleware/auth.js";
import { requireEntitlement } from "../../middleware/entitlements.js";
import { requireTenant } from "../../middleware/tenant.js";

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


// requireAuth + tenantContext already run for every /api route (app.js).
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
  // STUDENT sees only their own class's published sessions (scoped in the service).
  requireRole("ADMIN", "TEACHER", "STUDENT"),
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

// Take published results back to draft to correct them (ADMIN, reason required)
router.post(
  "/sessions/:id/unpublish",
  requireRole("ADMIN"),
  requireEntitlement("EXAMS_WRITE"),
  ctrl.unpublishResults
);

// ------------------------
// Term report cards (published exams of a term, combined by weight)
// ------------------------
router.get("/report-cards", requireRole("ADMIN", "TEACHER"), requireEntitlement("EXAMS_READ"), ctrl.getClassReportCards);
router.get(
  "/report-cards/students/:studentId",
  requireRole("ADMIN", "TEACHER", "STUDENT", "PARENT"),
  requireEntitlement("EXAMS_READ"),
  ctrl.getStudentReportCard
);
router.put("/report-cards/comments", requireRole("ADMIN", "TEACHER"), requireEntitlement("EXAMS_WRITE"), ctrl.saveReportComment);

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
  requireRole("ADMIN", "TEACHER", "STUDENT", "PARENT"),
  requireEntitlement("EXAMS_READ"),
  ctrl.getStudentResults
);

export default router;
