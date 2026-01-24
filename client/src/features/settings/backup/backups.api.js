// client/src/features/settings/backup/backups.api.js
import { api } from "@/api/axios";

export async function createBackup(params = {}) {
  const { data } = await api.post("/api/settings/backup/create", null, { params });
  return data;
}

export async function listBackups(params = {}) {
  const { data } = await api.get("/api/settings/backup", { params });
  return data?.backups ?? data;
}

export async function previewBackup(id, params = {}) {
  const { data } = await api.get(`/api/settings/backup/${id}/preview`, { params });
  return data?.backup ?? data;
}

export async function restoreBackup(id, payload = {}, params = {}) {
  const { data } = await api.post(`/api/settings/backup/${id}/restore`, payload, { params });
  return data;
}

// Download is a normal GET returning JSON attachment; easiest is open new tab
export function downloadBackupUrl(baseURL, id, schoolId) {
  const url = new URL(`/api/settings/backup/${id}/download`, baseURL);
  if (schoolId) url.searchParams.set("schoolId", schoolId);
  return url.toString();
}
