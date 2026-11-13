// Notices: shared labels and the list query.
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";

export const AUDIENCE_LABEL = { EVERYONE: "Everyone", STAFF: "Staff only", FAMILIES: "Learners and parents" };

/** One page of the board: { notices, total, page, pageSize }. */
export function useNoticesPage({ all = false, q = "", page = 1, pageSize = 10 } = {}) {
  return useQuery({
    queryKey: ["notices", "page", { all, q, page, pageSize }],
    queryFn: () =>
      api
        .get("/api/notices", { params: { page, pageSize, ...(all ? { all: 1 } : {}), ...(q ? { q } : {}) } })
        .then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

export function useNotices({ all = false, limit } = {}) {
  return useQuery({
    queryKey: ["notices", { all, limit }],
    queryFn: () => api.get("/api/notices", { params: { ...(all ? { all: 1 } : {}), ...(limit ? { limit } : {}) } }).then((r) => r.data.notices),
  });
}
