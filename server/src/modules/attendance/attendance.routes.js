// src/modules/attendance/attendance.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireSchool, requireAttendanceWrite } from "./attendance.permissions.js";

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

// Must be authenticated + have schoolId
router.use(requireAuth, requireSchool);

// READ endpoints (allow ADMIN/TEACHER)
router.get("/sessions", requireRole("ADMIN", "TEACHER"), list);
router.get("/sessions/:id", requireRole("ADMIN", "TEACHER"), getSession);

router.get("/summary/student/:studentId", requireRole("ADMIN", "TEACHER"), studentSummary);
router.get("/summary/class/:classId", requireRole("ADMIN", "TEACHER"), classSummary);
router.get("/defaulters", requireRole("ADMIN", "TEACHER"), defaultersList);

// WRITE endpoints (subscription + role)
router.post(
  "/sessions",
  requireRole("ADMIN", "TEACHER"),
  requireAttendanceWrite,
  createOrOpenSession
);

router.put(
  "/sessions/:id/records",
  requireRole("ADMIN", "TEACHER"),
  requireAttendanceWrite,
  updateRecords
);

router.post(
  "/sessions/:id/submit",
  requireRole("ADMIN", "TEACHER"),
  requireAttendanceWrite,
  submit
);

// ADMIN-only controls
router.post("/sessions/:id/unlock", requireRole("ADMIN"), requireAttendanceWrite, unlock);
router.post("/sessions/:id/lock", requireRole("ADMIN"), requireAttendanceWrite, lock);

export default router;
