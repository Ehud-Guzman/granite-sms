// client//src/features/settings/schools/schools.api.js
import { api } from "@/api/axios";

/**
 * Optional: A tiny helper so error messages are consistent across the app.
 * Keep backend messages when available (best for debugging).
 */
function unwrapError(err, fallback = "Request failed") {
  const msg =
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback;

  const e = new Error(msg);
  e.status = err?.response?.status;
  e.data = err?.response?.data;
  throw e;
}

/**
 * Schools API (SYSTEM_ADMIN only endpoints)
 * Backend contract assumed:
 * - GET    /api/schools                -> { schools: School[] } OR School[]
 * - POST   /api/schools                -> { school: School } OR School
 * - PATCH  /api/schools/:id            -> { school: School } OR School
 * - PATCH  /api/schools/:id/status     -> { school: School } OR School
 *
 * Notes:
 * - The server should enforce role checks. Frontend should also gate UI via capabilities.
 * - We intentionally don't hardcode role checks here to keep the API layer pure.
 */

// ---------- GET: list schools ----------
export async function listSchools() {
  try {
    const { data } = await api.get("/api/schools");
    // Support both possible server shapes
    if (Array.isArray(data)) return data;
    return data?.schools || [];
  } catch (err) {
    unwrapError(err, "Failed to load schools");
  }
}

// ---------- POST: create school ----------
/**
 * payload recommended:
 * {
 *   name: string,
 *   code?: string,   // e.g. "KPS"
 *   type?: string,   // optional if you have it: "PRIMARY" | "SECONDARY"
 * }
 */
export async function createSchool(payload) {
  try {
    const { data } = await api.post("/api/schools", payload);
    return data?.school || data;
  } catch (err) {
    unwrapError(err, "Failed to create school");
  }
}

// ---------- PATCH: update school ----------
/**
 * payload examples:
 * { name?: string, code?: string, type?: string }
 */
export async function updateSchool(id, payload) {
  try {
    const { data } = await api.patch(`/api/schools/${encodeURIComponent(id)}`, payload);
    return data?.school || data;
  } catch (err) {
    unwrapError(err, "Failed to update school");
  }
}

// ---------- PATCH: set school status (activate/deactivate) ----------
export async function setSchoolStatus(id, isActive) {
  try {
    const { data } = await api.patch(`/api/schools/${encodeURIComponent(id)}/status`, {
      isActive: !!isActive,
    });
    return data?.school || data;
  } catch (err) {
    unwrapError(err, "Failed to update school status");
  }
}

// ---------- Convenience helpers (optional) ----------

/**
 * Find one school by id from list.
 * This avoids creating a dedicated GET /api/schools/:id endpoint unless you want it.
 */
export async function getSchoolById(id) {
  const schools = await listSchools();
  return schools.find((s) => String(s.id) === String(id)) || null;
}

/**
 * Quick client-side search.
 * Helpful in SelectSchool dropdowns.
 */
export function searchSchools(schools, q) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return schools;

  return (schools || []).filter((s) => {
    const name = String(s?.name || "").toLowerCase();
    const code = String(s?.code || "").toLowerCase();
    return name.includes(query) || code.includes(query);
  });
}
