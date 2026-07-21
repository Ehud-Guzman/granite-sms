import { api } from "./axios";

export async function getFeesClassSummary(params) {
  const { data } = await api.get("/api/fees/reports/class-summary", { params });
  return data;
}

export async function getFeesDefaulters(params) {
  const { data } = await api.get("/api/fees/reports/defaulters", { params });
  return data;
}

export async function getFeesCollections(params) {
  const { data } = await api.get("/api/fees/reports/collections", { params });
  return data;
}

function pickFilenameFromDisposition(disposition, fallback) {
  try {
    if (!disposition) return fallback;
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
    if (!m?.[1]) return fallback;
    return decodeURIComponent(m[1]);
  } catch {
    return fallback;
  }
}

async function downloadReport(path, params, format, fallbackBase) {
  const res = await api.get(path, {
    params: { ...params, export: format },
    responseType: "blob",
  });

  const ext = format === "xlsx" ? "xlsx" : "csv";
  const fallback = `${fallbackBase}.${ext}`;
  const filename = pickFilenameFromDisposition(res.headers?.["content-disposition"], fallback);

  const blob = new Blob([res.data], { type: res.headers?.["content-type"] || undefined });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  window.URL.revokeObjectURL(url);
}

export function exportFeesClassSummary(params, format) {
  return downloadReport("/api/fees/reports/class-summary", params, format, "fees-class-summary");
}

export function exportFeesDefaulters(params, format) {
  return downloadReport("/api/fees/reports/defaulters", params, format, "fees-defaulters");
}

export function exportFeesCollections(params, format) {
  return downloadReport("/api/fees/reports/collections", params, format, "fees-collections");
}
