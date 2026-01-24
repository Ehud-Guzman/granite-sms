import { api } from "../../api/axios";

export async function listClasses({ year } = {}) {
  const params = {};
  if (year) params.year = String(year);

  const { data } = await api.get("/api/classes", { params });
  return Array.isArray(data) ? data : [];
}
