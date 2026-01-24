import { useQuery } from "@tanstack/react-query";
import { listExamSessions } from "@/api/exams.api";

export function useResultsSessions({ yearNum, term }) {
  return useQuery({
    queryKey: ["examSessions", { year: yearNum, term }],
    queryFn: () => listExamSessions({ year: yearNum, term }),
  });
}
