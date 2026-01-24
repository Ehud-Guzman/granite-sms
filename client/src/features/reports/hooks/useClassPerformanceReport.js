import { useQuery } from "@tanstack/react-query";
import { getClassPerformanceReport } from "@/api/reports.api";

export function useClassPerformanceReport({ sessionId, enabled = true }) {
  return useQuery({
    enabled: Boolean(sessionId) && enabled,
    queryKey: ["classPerformanceReport", sessionId],
    queryFn: () => getClassPerformanceReport(sessionId), // ✅ pass string ONLY
  });
}
