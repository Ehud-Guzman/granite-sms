import { useQuery } from "@tanstack/react-query";
import { getClassResults } from "@/api/results.api";

export function useClassResults({ enabled, sessionId }) {
  return useQuery({
    enabled: !!enabled && !!sessionId,
    queryKey: ["classResults", sessionId],
    queryFn: () => getClassResults(sessionId),
  });
}
