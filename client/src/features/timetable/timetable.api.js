// Timetable API (server: modules/timetable/timetable.routes.js).
import { api } from "@/api/axios";

export const DAY_NAMES = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
export const DAY_SHORT = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

export const getSetup = () => api.get("/api/timetable/setup").then((r) => r.data);
export const saveDays = (days, removeLessons = false) => api.put("/api/timetable/days", { days, removeLessons }).then((r) => r.data);
export const saveSchedule = (id, body) => (id ? api.put(`/api/timetable/schedules/${id}`, body) : api.post("/api/timetable/schedules", body)).then((r) => r.data);
export const makeDefaultSchedule = (id) => api.post(`/api/timetable/schedules/${id}/default`).then((r) => r.data);
export const deleteSchedule = (id, removeLessons = false) => api.delete(`/api/timetable/schedules/${id}`, { params: removeLessons ? { removeLessons: 1 } : {} }).then((r) => r.data);
export const setClassSchedule = (classId, scheduleId, removeLessons = false) => api.put(`/api/timetable/classes/${classId}/schedule`, { scheduleId, removeLessons }).then((r) => r.data);
export const moveLesson = (classId, from, to) => api.put(`/api/timetable/classes/${classId}/move`, { from, to }).then((r) => r.data);
export const saveRoom = (id, body) => (id ? api.put(`/api/timetable/rooms/${id}`, body) : api.post("/api/timetable/rooms", body)).then((r) => r.data);
export const deleteRoom = (id) => api.delete(`/api/timetable/rooms/${id}`).then((r) => r.data);
export const getTeacherRules = (teacherId) => api.get(`/api/timetable/teachers/${teacherId}/rules`).then((r) => r.data);
export const saveTeacherRules = (teacherId, body) => api.put(`/api/timetable/teachers/${teacherId}/rules`, body).then((r) => r.data);
export const copyForward = (fromYear, toYear) => api.post("/api/timetable/copy", { fromYear, toYear }).then((r) => r.data);
export const getClassTimetable = (classId) => api.get(`/api/timetable/classes/${classId}`).then((r) => r.data);
export const setSlot = (classId, body) => api.put(`/api/timetable/classes/${classId}/slot`, body).then((r) => r.data);
export const setTargets = (classId, items) => api.put(`/api/timetable/classes/${classId}/targets`, { items }).then((r) => r.data);
export const previewAutofill = (params) => api.get("/api/timetable/autofill", { params }).then((r) => r.data);
export const applyAutofill = (body) => api.post("/api/timetable/autofill", body).then((r) => r.data);
export const getTeacherTimetable = (teacherId) => api.get(`/api/timetable/teachers/${teacherId}`).then((r) => r.data);
export const getMyTimetable = () => api.get("/api/timetable/me").then((r) => r.data);
export const getToday = () => api.get("/api/timetable/today").then((r) => r.data);

/** "08:40" -> 520 */
export const minutes = (t) => {
  const [h, m] = String(t || "").split(":").map(Number);
  return h * 60 + m;
};
