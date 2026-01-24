// src/api/axios.js
import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_URL?.trim() || "http://localhost:5000";


export const api = axios.create({
  baseURL,
  withCredentials: false, // JWT header auth
});

// Optional event system so app can react to REAL auth loss
export const authEvents = new EventTarget();

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  const schoolId = localStorage.getItem("schoolId"); // ✅ tenant id (x-school-id)

  config.headers = config.headers ?? {};

  // Auth header
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }

  // ✅ Multi-tenant header required by backend tenantContext
  // - ADMIN calls: should always have schoolId set
  // - SYSTEM_ADMIN calls: may be platform scope (no schoolId) OR tenant-inspection (set schoolId)
  if (schoolId) {
    config.headers["x-school-id"] = schoolId;
  } else {
    delete config.headers["x-school-id"];
  }

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";

    // ✅ Only logout when /api/me fails (single source of truth for identity)
   // inside response interceptor, in the 401 handler:
if (status === 401 && url.includes("/api/me")) {
  localStorage.removeItem("token");
  localStorage.removeItem("schoolId");
  localStorage.removeItem("selectedSchool");
  authEvents.dispatchEvent(new Event("logout"));
}

    // ❌ Do NOT logout for other endpoints (attendance, fees, etc.)
    return Promise.reject(err);
  }
);
