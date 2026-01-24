

import { api } from "./axios";

export async function getDashboardSummary() {
  const { data } = await api.get("/api/dashboard/summary");
  return data?.data ?? data; // supports either shape
}

export async function getDashboardActivity(params = {}) {
  const { data } = await api.get("/api/dashboard/activity", { params });
  return data?.data ?? data;
}
