// src/api/exams.api.js
import { api } from "./axios";

/**
 * -------------------------
 * Helpers
 * -------------------------
 */

// Remove undefined/null/"" from params to avoid backend validation 400s
function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

// Backend common response shapes:
// 1) [] (raw array)
// 2) { data: [] }
// 3) { success: true, data: [] }
// 4) { success: true, data: {...} }
function unwrap(payload) {
  if (payload == null) return payload;

  // axios .data already extracted, but backend might wrap actual payload in .data
  if (typeof payload === "object" && "data" in payload) return payload.data;

  return payload;
}

function asArray(payload) {
  const x = unwrap(payload);
  return Array.isArray(x) ? x : [];
}

function asObject(payload) {
  const x = unwrap(payload);
  return x && typeof x === "object" && !Array.isArray(x) ? x : null;
}

function errMessage(err, fallback = "Request failed") {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback
  );
}

// Detect Prisma unique constraint message (since your backend currently sends raw prisma text)
// Example: "Unique constraint failed on the fields: (`schoolId`,`year`,`term`,`classId`,`examTypeId`)"
function isDuplicateSessionError(err) {
  const msg = String(err?.response?.data?.message || err?.message || "");
  return msg.includes("Unique constraint failed") && msg.includes("examSession.create");
}

/**
 * -------------------------
 * Exam Types
 * -------------------------
 */

export async function listExamTypes() {
  try {
    const { data } = await api.get("/api/exams/types");
    return asArray(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to load exam types"));
  }
}

export async function createExamType(payload) {
  try {
    const { data } = await api.post("/api/exams/types", payload);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to create exam type"));
  }
}

/**
 * -------------------------
 * Exam Sessions
 * -------------------------
 */

export async function listExamSessions(params = {}) {
  try {
    const clean = cleanParams(params);
    const { data } = await api.get("/api/exams/sessions", { params: clean });
    return asArray(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to load exam sessions"));
  }
}

export async function createExamSession(payload) {
  try {
    const cleanPayload = {
      name: payload?.name ? String(payload.name).trim() : null,
      year: payload?.year !== undefined ? Number(payload.year) : undefined,
      term: payload?.term ? String(payload.term).trim().toUpperCase() : undefined,
      classId: payload?.classId ? String(payload.classId) : undefined,
      examTypeId: payload?.examTypeId ? String(payload.examTypeId) : undefined,
      startsOn: payload?.startsOn ?? undefined,
      endsOn: payload?.endsOn ?? undefined,
    };

    const { data } = await api.post("/api/exams/sessions", cleanPayload);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    // Special-case duplicate session so UI can show a clean message
    if (isDuplicateSessionError(err)) {
      const e = new Error(
        "Exam session already exists for this class, year, term and exam type."
      );
      e.code = "EXAM_SESSION_EXISTS";
      throw e;
    }

    throw new Error(errMessage(err, "Failed to create exam session"));
  }
}

/**
 * -------------------------
 * MarkSheets
 * -------------------------
 */

export async function listSessionMarkSheets(sessionId) {
  if (!sessionId) throw new Error("sessionId is required");
  try {
    const { data } = await api.get(`/api/exams/sessions/${sessionId}/marksheets`);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to load session marksheets"));
  }
}

export async function getMarkSheet(marksheetId) {
  if (!marksheetId) throw new Error("marksheetId is required");
  try {
    const { data } = await api.get(`/api/exams/marksheets/${marksheetId}`);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to load marksheet"));
  }
}

export async function upsertBulkMarks(marksheetId, payload) {
  if (!marksheetId) throw new Error("marksheetId is required");
  try {
    const { data } = await api.put(`/api/exams/marksheets/${marksheetId}/marks`, payload);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to save marks"));
  }
}

export async function submitMarkSheet(marksheetId) {
  if (!marksheetId) throw new Error("marksheetId is required");
  try {
    const { data } = await api.post(`/api/exams/marksheets/${marksheetId}/submit`);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to submit marksheet"));
  }
}

export async function unlockMarkSheet(marksheetId, payload) {
  if (!marksheetId) throw new Error("marksheetId is required");
  const reason = payload?.reason ? String(payload.reason).trim() : "";
  if (!reason) throw new Error("reason is required");

  try {
    const { data } = await api.post(`/api/exams/marksheets/${marksheetId}/unlock`, { reason });
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to unlock marksheet"));
  }
}

/**
 * -------------------------
 * Publish Results
 * -------------------------
 */

export async function publishResults(sessionId) {
  if (!sessionId) throw new Error("sessionId is required");
  try {
    const { data } = await api.post(`/api/exams/sessions/${sessionId}/publish`);
    return asObject(data) ?? unwrap(data);
  } catch (err) {
    throw new Error(errMessage(err, "Failed to publish results"));
  }
}
