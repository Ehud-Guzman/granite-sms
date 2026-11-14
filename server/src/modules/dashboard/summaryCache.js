// src/modules/dashboard/summaryCache.js
// The dashboard summary, kept for 60 s per school and viewer (audit 2,
// A2-PERF-01), like the user and school caches in middleware/tenant.js.
//
// A school's entries are dropped as soon as anything is written for it:
// app.js clears them after every successful POST/PUT/PATCH/DELETE made in a
// school, and M-Pesa payments (which arrive without a signed-in user) clear
// them in modules/mpesa/ingest.js. So a register marked or a payment taken
// shows on the next load; the 60 s only covers reads.
//
// In-memory, so it assumes one server process. With more than one instance
// a write on one wouldn't clear the others: move this to Redis (or drop the
// cache) before scaling out.

const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const CACHE = new Map(); // key -> { data, exp, schoolId }
// Bumped on every invalidation, so a summary that was being worked out while
// a write landed isn't stored afterwards with the old figures.
const GENERATION = new Map(); // schoolId -> number

/** Take before computing; pass to setCachedSummary. */
export function summaryGeneration(schoolId) {
  return GENERATION.get(String(schoolId)) || 0;
}

function ttl() {
  const n = Number(process.env.DASHBOARD_CACHE_MS);
  return Number.isFinite(n) && n >= 0 ? n : TTL_MS;
}

/**
 * What the summary depends on besides the school: fee roles all see the same
 * figures; a TEACHER sees only their own classes, so each teacher has their own.
 */
export function summaryKey({ schoolId, role, teacherId }) {
  const r = String(role || "").toUpperCase();
  return `${schoolId}|${r}|${r === "TEACHER" ? teacherId || "" : ""}`;
}

export function getCachedSummary(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  return hit.data;
}

export function setCachedSummary(key, schoolId, data, generation = summaryGeneration(schoolId)) {
  const ms = ttl();
  if (!ms || generation !== summaryGeneration(schoolId)) return data;
  if (CACHE.size >= MAX_ENTRIES) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { data, exp: Date.now() + ms, schoolId: String(schoolId) });
  return data;
}

/** Drop every cached summary for a school (after a payment, register, etc.). */
export function invalidateSchoolSummary(schoolId) {
  if (!schoolId) return;
  const id = String(schoolId);
  GENERATION.set(id, summaryGeneration(id) + 1);
  for (const [k, v] of CACHE) if (v.schoolId === id) CACHE.delete(k);
}
