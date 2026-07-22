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
