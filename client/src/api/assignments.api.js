// src/api/assignments.api.js
import { api } from "./axios";

export async function listAssignments(params = {}) {
  const { data } = await api.get("/api/assignments", { params });
  return Array.isArray(data) ? data : [];
}

export async function createAssignment({ teacherId, classId, subjectId }) {
  const { data } = await api.post("/api/assignments", { teacherId, classId, subjectId });
  return data;
}

export async function deactivateAssignment(id) {
  const { data } = await api.patch(`/api/assignments/${id}/deactivate`);
  return data;
}
