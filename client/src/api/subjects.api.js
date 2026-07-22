// src/api/subjects.api.js
import { api } from "./axios";

export async function listSubjects() {
  const { data } = await api.get("/api/subjects");
  return Array.isArray(data) ? data : [];
}

export async function createSubject({ name, code }) {
  const { data } = await api.post("/api/subjects", { name, code: code || null });
  return data;
}

export async function updateSubject(id, payload) {
  const { data } = await api.patch(`/api/subjects/${id}`, payload);
  return data;
}

export async function deactivateSubject(id) {
  const { data } = await api.patch(`/api/subjects/${id}/deactivate`);
  return data;
}
