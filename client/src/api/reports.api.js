import { api } from "./axios";
import { getErrorMessage } from "@/lib/errors";

export async function getClassPerformanceReport(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("sessionId is required (string)");
  }

  try {
    const { data } = await api.get("/api/reports/class-performance", {
      params: { sessionId }, // ✅ correct
    });
    return data; // { data: report }
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
}

function pickFilenameFromDisposition(disposition, fallback) {
  try {
    const m = /filename="?([^"]+)"?/i.exec(disposition || "");
    if (!m?.[1]) return fallback;
    return decodeURIComponent(m[1]);
  } catch {
    return fallback;
  }
}

export async function exportClassPerformanceReport(sessionId, format) {
  const res = await api.get("/api/reports/class-performance", {
    params: { sessionId, export: format },
    responseType: "blob",
  });

  const ext = format === "xlsx" ? "xlsx" : "csv";
  const fallback = `class-performance-${sessionId}.${ext}`;
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
