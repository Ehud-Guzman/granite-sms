import { api, authEvents } from "./axios";

const TOKEN_KEY = "token";
const SELECTED_SCHOOL_KEY = "selectedSchool";
const SCHOOL_ID_KEY = "schoolId";

/* ----------------------------------------
   TOKEN HANDLERS
---------------------------------------- */

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/* ----------------------------------------
   SELECTED SCHOOL (SYSTEM_ADMIN CONTEXT)
---------------------------------------- */

export function getSelectedSchool() {
  try {
    const raw = localStorage.getItem(SELECTED_SCHOOL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSelectedSchool(school) {
  if (!school) return;

  localStorage.setItem(SELECTED_SCHOOL_KEY, JSON.stringify(school));

  // ✅ ensure axios can attach x-school-id
  const id = school?.id || school?.schoolId;
  if (id) localStorage.setItem(SCHOOL_ID_KEY, String(id));
}

export function clearSelectedSchool() {
  localStorage.removeItem(SELECTED_SCHOOL_KEY);
  localStorage.removeItem(SCHOOL_ID_KEY);
}

/* ----------------------------------------
   AUTH API CALLS
---------------------------------------- */

export async function login(payload) {
  const { data } = await api.post("/api/auth/login", payload);

  if (data?.token) {
    setToken(data.token);
    // Clear any previously selected school on fresh login
    clearSelectedSchool();
  }

  return data;
}

export async function me() {
  const { data } = await api.get("/api/me");
  return data; // { user }
}

/* ----------------------------------------
   SYSTEM_ADMIN SCHOOL SWITCH
---------------------------------------- */

export async function selectSchool(schoolId) {
  const { data } = await api.post("/api/auth/select-school", { schoolId });

  if (data?.token) {
    setToken(data.token);
  }

  if (data?.school) {
    setSelectedSchool(data.school);
  } else if (schoolId) {
    // fallback: still set header context
    localStorage.setItem(SCHOOL_ID_KEY, String(schoolId));
  }

  return data;
}

/* ----------------------------------------
   LOGOUT
---------------------------------------- */

export function logout() {
  clearToken();
  clearSelectedSchool();
  authEvents?.dispatchEvent(new Event("logout"));
}
