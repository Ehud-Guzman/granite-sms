import { api } from "../../api/axios";

// --------------------
// Students
// --------------------
export async function listStudents({ active = true, classId } = {}) {
  const params = {};
  if (active !== undefined) params.active = String(active);
  if (classId) params.classId = String(classId);

  const { data } = await api.get("/api/students", { params });
  return Array.isArray(data) ? data : [];
}

export async function getStudent(id) {
  const { data } = await api.get(`/api/students/${id}`);
  return data;
}

// Fast lookup (cashier flow)
// GET /api/students/lookup?admissionNo=...
export async function lookupStudentByAdmissionNo(admissionNo) {
  const adm = String(admissionNo || "").trim();
  if (!adm) throw new Error("admissionNo is required");

  const { data } = await api.get("/api/students/lookup", {
    params: { admissionNo: adm },
  });

  return data?.student;
}

export async function createStudent(payload) {
  const { data } = await api.post("/api/students", payload);
  return data;
}

export async function updateStudent(id, payload) {
  const { data } = await api.patch(`/api/students/${id}`, payload);
  return data;
}

export async function assignStudentClass(id, classId) {
  const { data } = await api.patch(`/api/students/${id}/assign-class`, {
    classId,
  });
  return data;
}

export async function deactivateStudent(id) {
  const { data } = await api.patch(`/api/students/${id}/deactivate`);
  return data;
}

// --------------------
// Class Teachers (TEMP approach)
// --------------------
// Backend: GET /api/class-teachers returns rows tenant-scoped.
// FE filters by teacherId for now.
// Later improvement: backend endpoint like /api/class-teachers/mine
export async function listClassTeachers() {
  const { data } = await api.get("/api/class-teachers");
  return Array.isArray(data) ? data : [];
}

export async function getTeacherAssignedClasses(teacherId) {
  const rows = await listClassTeachers();
  return rows.filter((r) => String(r.teacherId) === String(teacherId));
}
