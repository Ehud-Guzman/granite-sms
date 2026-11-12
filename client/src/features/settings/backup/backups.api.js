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
/**
 * Downloads a backup file through the shared API client, so the request is
 * signed in and goes to the configured API (window.open on a bare URL sent
 * no token and used a different env variable: audit M11).
 */
export async function downloadBackup(id, schoolId) {
  const res = await api.get(`/api/settings/backup/${id}/download`, {
    params: schoolId ? { schoolId } : undefined,
    responseType: "blob",
  });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = `backup_${schoolId || "school"}_${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
