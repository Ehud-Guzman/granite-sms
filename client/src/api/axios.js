// src/api/axios.js
import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL?.trim() || "http://localhost:5000";

export const api = axios.create({
  baseURL,
  withCredentials: false,
});

// Global event buses
export const authEvents = new EventTarget();
export const subscriptionEvents = new EventTarget();

// ---------------------------
// Helpers
// ---------------------------
function safeUpper(v) {
  return String(v || "").trim().toUpperCase();
}

function getStoredUserRole() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return "";
    const u = JSON.parse(raw);
    return safeUpper(u?.role);
  } catch {
    return "";
  }
}

// Single source of truth for tenant selection on client
function getStoredSchoolId() {
  // support both keys just in case
  const a = String(localStorage.getItem("schoolId") || "").trim();
  const b = String(localStorage.getItem("selectedSchool") || "").trim();
  return a || b;
}

// ---------------------------
// Request interceptor
// ---------------------------
api.interceptors.request.use((config) => {
  const token = String(localStorage.getItem("token") || "").trim();
  const role = getStoredUserRole(); // kept for logging/diagnostics if you need it
  const schoolId = getStoredSchoolId();

  config.headers = config.headers ?? {};

  // Auth header
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else delete config.headers.Authorization;

  /**
   * ✅ Tenant scoping header (IMPORTANT)
   * Your tenantContext/requireTenant middleware depends on req.schoolId.
   * So we ALWAYS send x-school-id whenever we have a stored schoolId,
   * regardless of role (ADMIN, TEACHER, SYSTEM_ADMIN, etc.).
   *
   * Server must still enforce ownership/tenancy rules — header is context,
   * not authority.
   */
  if (schoolId) config.headers["x-school-id"] = schoolId;
  else delete config.headers["x-school-id"];

  // Optional: useful for debugging server logs (harmless)
  if (role) config.headers["x-role"] = role;
  else delete config.headers["x-role"];

  return config;
});

// ---------------------------
// Response interceptor
// ---------------------------
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";
    const data = err?.response?.data || {};

    // ✅ Logout on any 401 (expired/invalid token), except a handful of
    // auth endpoints that legitimately return 401 for reasons OTHER than
    // "your session is invalid" while the caller is still validly logged
    // in — login/register (bad credentials) and change-password (wrong
    // current password, see server/src/routes/auth.js's /change-password
    // route) must not clear storage or force a logout redirect.
    // Previously this only fired for /api/me, so a token that expired
    // mid-session would keep failing silently on every other endpoint
    // (mutations, other GETs) with no redirect back to login.
    const isAuthAttempt =
      url.includes("/api/auth/login") ||
      url.includes("/api/auth/register") ||
      url.includes("/api/auth/change-password");

    if (status === 401 && !isAuthAttempt) {
      localStorage.removeItem("token");
      localStorage.removeItem("schoolId");
      localStorage.removeItem("selectedSchool");
      localStorage.removeItem("user");
      authEvents.dispatchEvent(new Event("logout"));
      return Promise.reject(err);
    }

    // ✅ Subscription / limits handling
    // Backend patterns:
    // - 402 with code: NO_SUBSCRIPTION, SUBSCRIPTION_EXPIRED, SUBSCRIPTION_INACTIVE
    // - 409 with code: LIMIT_REACHED
    const code = safeUpper(data?.code);

    const isSubBlock =
      status === 402 &&
      ["NO_SUBSCRIPTION", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_INACTIVE"].includes(code);

    const isLimitHit = status === 409 && code === "LIMIT_REACHED";

    if (isSubBlock || isLimitHit) {
      subscriptionEvents.dispatchEvent(
        new CustomEvent("subscription:block", {
          detail: {
            type: code || "BLOCKED",
            status,
            data: {
              ...data,
              message: data?.message || "Action blocked by subscription policy.",
            },
          },
        })
      );
    }

    return Promise.reject(err);
  }
);
