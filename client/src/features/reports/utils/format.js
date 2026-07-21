// src/features/reports/utils/format.js
// Shared formatters for the reports feature. Previously each report page
// (ClassPerformanceReport, FeesSummaryReport, FeesDefaultersReport) declared
// its own near-identical copy of these — this file was created for that
// purpose but left empty, so nothing actually used it.

/** Unwrap a query response into a plain array, whatever shape the API used. */
export function normalizeArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (Array.isArray(maybe?.data)) return maybe.data;
  if (Array.isArray(maybe?.sessions)) return maybe.sessions;
  if (Array.isArray(maybe?.data?.data)) return maybe.data.data;
  return [];
}

export function fmtClass(c) {
  if (!c) return "-";
  return `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`;
}

export function fmtMoney(n) {
  return Number(n || 0).toLocaleString();
}

export function fmtNumber(n, dp = 0) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return dp ? "0.00" : "0";
  return dp > 0 ? v.toFixed(dp) : v.toLocaleString();
}

export function fmtDateTime(d = new Date()) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
}

export function fmtStudentName(s) {
  const first = s?.firstName || "";
  const last = s?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}
