// client/src/api/teachers.api.js
import { api } from "./axios";

export async function listTeachers() {
  const { data } = await api.get("/api/users", { params: { role: "TEACHER" } });
  const users = data?.users ?? data;
  return Array.isArray(users) ? users : [];
}

export async function deactivateTeacher(id) {
  const { data } = await api.post(`/api/users/${id}/status`, { isActive: false });
  return data?.user ?? data;
}

export async function activateTeacher(id) {
  const { data } = await api.post(`/api/users/${id}/status`, { isActive: true });
  return data?.user ?? data;
}
