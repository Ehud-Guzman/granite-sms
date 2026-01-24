import { api } from "./axios";

export async function listTeachers() {
  const { data } = await api.get("/api/teachers");
  return Array.isArray(data) ? data : [];
}

export async function deactivateTeacher(id) {
  const { data } = await api.patch(`/api/teachers/${id}/deactivate`);
  return data; // { message, user }
}

export async function activateTeacher(id) {
  const { data } = await api.patch(`/api/teachers/${id}/activate`);
  return data; // { message, user }
}
