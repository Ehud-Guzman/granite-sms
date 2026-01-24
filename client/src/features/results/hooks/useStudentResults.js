import { useQuery } from "@tanstack/react-query";
import { getStudentResults } from "@/api/results.api";

export function useStudentResults({ enabled, sessionId, studentId }) {
  return useQuery({
    enabled: !!enabled && !!sessionId && !!studentId,
    queryKey: ["studentResults", sessionId, studentId],
    queryFn: () => getStudentResults(sessionId, studentId),
  });
}
