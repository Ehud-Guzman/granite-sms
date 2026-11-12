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

export async function getTermDates(params = {}) {
  const { data } = await api.get("/api/settings/academics", { params });
  return data.termDates || [];
}

/** Replaces one year's term dates: terms = [{ term, startsOn, endsOn }] */
export async function putTermDates(year, terms, params = {}) {
  const { data } = await api.put("/api/settings/academics/term-dates", { year, terms }, { params });
  return data.termDates;
}

export async function getFeatureFlags() {
  const { data } = await api.get("/api/settings");
  return data;
}

export async function updateFeatureFlags(payload) {
  const { data } = await api.patch("/api/settings", payload);
  return data;
}
