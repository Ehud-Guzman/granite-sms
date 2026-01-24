import { api } from "@/api/axios";

export async function getSchoolProfile(params = {}) {
  const { data } = await api.get("/api/settings/school", { params });
  return data.school;
}

export async function patchSchoolProfile(payload, params = {}) {
  const { data } = await api.patch("/api/settings/school", payload, { params });
  return data.school;
}

export async function getAcademics(params = {}) {
  const { data } = await api.get("/api/settings/academics", { params });
  return data.academics;
}

export async function patchAcademics(payload, params = {}) {
  const { data } = await api.patch("/api/settings/academics", payload, { params });
  return data.academics;
}
