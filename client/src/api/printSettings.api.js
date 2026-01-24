import { api } from "@/api/axios";

export async function getPrintSettings(params = {}) {
  const { data } = await api.get("/api/settings/print", { params });
  return data.print; // ✅ confirmed shape
}
