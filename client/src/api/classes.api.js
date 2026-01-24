// src/api/classes.api.js
import { api } from "./axios";

export async function listClasses({ year } = {}) {
  const params = {};
  if (year) params.year = year;

  const { data } = await api.get("/api/classes", { params });
  return Array.isArray(data) ? data : [];
}

export async function createClass(payload) {
  const { data } = await api.post("/api/classes", payload);
  return data;
}
export async function getClass(id) {
  const { data } = await api.get(`/api/classes/${id}`);
  return data; // expected: { id, name, stream, year, ... }
}

export async function unlockMarkSheet(marksheetId, payload) {
  // payload must be: { reason: string }
  const { data } = await api.post(`/api/exams/marksheets/${marksheetId}/unlock`, payload);
  return data;
}
