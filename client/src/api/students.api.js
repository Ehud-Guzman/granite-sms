import { api } from "./axios";

export async function listStudents(params = {}) {
  const { data } = await api.get("/api/students", { params });
  return data; // array
}
export async function getClassResults(sessionId) {
  const { data } = await api.get(`/api/exams/sessions/${sessionId}/results/class`);
  return data; // { success, data: {...} }
}

export async function getStudentResults(sessionId, studentId) {
  const { data } = await api.get(
    `/api/exams/sessions/${sessionId}/results/students/${studentId}`
  );
  return data;
}

export async function publishResults(sessionId) {
  const { data } = await api.post(`/api/exams/sessions/${sessionId}/publish`);
  return data;
}