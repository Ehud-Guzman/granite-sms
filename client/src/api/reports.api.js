import { api } from "./axios";

function errMsg(err) {
  return err?.response?.data?.message || err?.message || "Request failed";
}

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
    throw new Error(errMsg(err));
  }
}
