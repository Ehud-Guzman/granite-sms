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
