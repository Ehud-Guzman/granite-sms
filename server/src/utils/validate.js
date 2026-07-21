// src/utils/validate.js
// Shared primitive parsers/validators. Previously each route file declared
// its own copy of these (cleanStr in 5 files, toInt in 2, upper in 5+,
// isValidId/isValidSchoolId in 3) — always trivial, but drift-prone: a fix
// or edge case handled in one copy silently wouldn't apply to the others.

export function upper(v) {
  return String(v || "").trim().toUpperCase();
}

/** Trim a string field; anything that isn't already a string (including null/undefined) becomes "". */
export function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** School/tenant-id-style identifier: letters, numbers, _/-, 3-40 chars. */
export function isValidId(v) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(String(v || "").trim());
}

/** Parse to integer; returns `fallback` for empty/invalid input. */
export function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Parse to number (float-preserving); returns `fallback` for empty/invalid input. */
export function toNumber(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
