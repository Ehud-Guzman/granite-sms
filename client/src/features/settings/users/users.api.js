// client/src/features/settings/users/users.api.js
import { api } from "@/api/axios";

export async function listUsers(params = {}) {
  const { data } = await api.get("/api/users", { params });
  return data?.users ?? data;
}

export async function createUser(payload) {
  const { data } = await api.post("/api/users", payload);
  // expects: { user, tempPassword }
  return data;
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/api/users/${id}`, payload);
  return data?.user ?? data;
}

export async function setUserStatus(id, isActive) {
  const { data } = await api.post(`/api/users/${id}/status`, { isActive });
  return data?.user ?? data;
}

export async function resetUserPassword(id) {
  const { data } = await api.post(`/api/users/${id}/reset-password`, {});
  // expects: { ok, tempPassword }
  return data;
}
