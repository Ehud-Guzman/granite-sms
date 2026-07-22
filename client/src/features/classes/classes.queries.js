import { useQuery } from "@tanstack/react-query";
import { listClasses } from "@/api/classes.api";

export function useClasses(year, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["classes", { year: year || null }],
    queryFn: () => listClasses({ year }),
    enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}
