// src/api/results.api.js
import { api } from "./axios";

/**
 * ----------------------------------------
 * RESULTS (read-only)
 * Backend source of truth:
 * /api/exams/sessions/:id/results/*
 * ----------------------------------------
 */

/**
 * Get class results (ADMIN / TEACHER)
 * GET /api/exams/sessions/:sessionId/results/class
 */
export async function getClassResults(sessionId) {
  if (!sessionId) throw new Error("sessionId is required");
  const { data } = await api.get(
    `/api/exams/sessions/${sessionId}/results/class`
  );
  return data;
}

/**
 * Get a specific student's results
 * - STUDENT: own results only
 * - ADMIN / TEACHER: drilldown
 *
 * GET /api/exams/sessions/:sessionId/results/students/:studentId
 */
export async function getStudentResults(sessionId, studentId) {
  if (!sessionId || !studentId) {
    throw new Error("sessionId and studentId are required");
  }

  const { data } = await api.get(
    `/api/exams/sessions/${sessionId}/results/students/${studentId}`
  );
  return data;
}
