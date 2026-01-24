import { api } from "@/api/axios";

export async function getBranding(params = {}) {
  const { data } = await api.get("/api/settings/branding", { params });
  return data.branding;
}

export async function patchBranding(payload, params = {}) {
  const { data } = await api.patch("/api/settings/branding", payload, { params });
  return data.branding;
}

export async function uploadBrandLogo(file, params = {}) {
  const form = new FormData();
  form.append("logo", file);

  const { data } = await api.post("/api/settings/branding/logo", form, {
    params,
    headers: { "Content-Type": "multipart/form-data" },
  });

  return data.branding;
}
