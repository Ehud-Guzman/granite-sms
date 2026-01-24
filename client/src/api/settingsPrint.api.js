import { api } from "@/api/axios";

export async function getPrintSettings(params = {}) {
  const { data } = await api.get("/api/settings/print", { params });
  return data?.print;
}

export async function patchPrintSettings(payload, params = {}) {
  const { data } = await api.patch("/api/settings/print", payload, { params });
  return data?.print;
}
