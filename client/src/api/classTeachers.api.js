import { api } from "./axios";

// Adjust paths to match your backend routes
export async function listClassTeachers() {
  const { data } = await api.get("/api/class-teachers");
  return data;
}

export async function assignClassTeacher({ classId, teacherId }) {
  const { data } = await api.post("/api/class-teachers", { classId, teacherId });
  return data;
}
