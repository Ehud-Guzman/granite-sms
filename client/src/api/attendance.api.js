// src/api/attendance.api.js
import { api } from "./axios";

// GET /api/attendance/sessions?classId=...&date=YYYY-MM-DD&status=...
export async function listAttendanceSessions(params = {}) {
  const { data } = await api.get("/api/attendance/sessions", { params });
  return data;
}

// POST /api/attendance/sessions
// Payload MUST include { classId, date, year, term }
export async function createOrOpenAttendanceSession(payload) {
  const classId = String(payload?.classId || "").trim();
  const date = String(payload?.date || "").trim();
  const year = Number(payload?.year);
  const term = payload?.term;

  if (!classId) throw new Error("classId is required");
  if (!date) throw new Error("date is required");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("year is required and must be a valid integer (2000-2100)");
  }

  const body = { classId, date, year };
  if (term) body.term = term;

  const { data } = await api.post("/api/attendance/sessions", body);
  return data;
}

// GET /api/attendance/sessions/:id
export async function getAttendanceSession(id) {
  const { data } = await api.get(`/api/attendance/sessions/${id}`);
  return data;
}

// PUT /api/attendance/sessions/:id/records   { records: [...] }
export async function updateAttendanceRecords(id, records) {
  const { data } = await api.put(`/api/attendance/sessions/${id}/records`, { records });
  return data;
}

// POST /api/attendance/sessions/:id/submit
export async function submitAttendanceSession(id) {
  const { data } = await api.post(`/api/attendance/sessions/${id}/submit`);
  return data;
}

// ADMIN controls
export async function lockAttendanceSession(id) {
  const { data } = await api.post(`/api/attendance/sessions/${id}/lock`);
  return data;
}

export async function unlockAttendanceSession(id) {
  const { data } = await api.post(`/api/attendance/sessions/${id}/unlock`);
  return data;
}

// Reports
export async function attendanceClassSummary(classId, params = {}) {
  const { data } = await api.get(`/api/attendance/summary/class/${classId}`, { params });
  return data;
}

export async function attendanceDefaulters(params = {}) {
  const { data } = await api.get(`/api/attendance/defaulters`, { params });
  return data;
}
