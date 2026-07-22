import { api } from "./axios";

export async function listStudents(params = {}) {
  const { data } = await api.get("/api/students", { params });
  return data; // array
}