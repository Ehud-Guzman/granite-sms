import { useQuery } from "@tanstack/react-query";
import { me } from "@/api/auth.api";
import { getToken } from "@/api/auth.api";

export function useMe() {
  const token = getToken();

  return useQuery({
    queryKey: ["me"],
    queryFn: me,
    enabled: !!token,     // don't hit /me if no token
    retry: false,         // expired token shouldn't retry spam
    staleTime: 60 * 1000,
  });
}
