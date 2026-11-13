// Notices: shared labels and the list query.
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";

export const AUDIENCE_LABEL = { EVERYONE: "Everyone", STAFF: "Staff only", FAMILIES: "Learners and parents" };

export function useNotices({ all = false, limit } = {}) {
  return useQuery({
    queryKey: ["notices", { all, limit }],
    queryFn: () => api.get("/api/notices", { params: { ...(all ? { all: 1 } : {}), ...(limit ? { limit } : {}) } }).then((r) => r.data.notices),
  });
}
