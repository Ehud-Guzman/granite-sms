import { useQuery } from "@tanstack/react-query";
import { listClasses } from "./classes.api";

export function useClasses(year) {
  return useQuery({
    queryKey: ["classes", { year: year || null }],
    queryFn: () => listClasses({ year }),
    retry: false,
    staleTime: 60 * 1000,
  });
}
