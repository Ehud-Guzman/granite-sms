import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/axios";

export async function fetchSubscriptionOverview() {
  const { data } = await api.get("/api/settings/subscription/overview");
  return data;
}

export function useSubscriptionOverview({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["subscriptionOverview"],
    queryFn: fetchSubscriptionOverview,
    enabled,
    staleTime: 60 * 1000, // 1 min
    retry: false,
  });
}
