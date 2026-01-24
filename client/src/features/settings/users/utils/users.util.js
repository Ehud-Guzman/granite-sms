// client/src/features/settings/users/utils/users.util.js

export function cleanEmail(v) {
  return String(v || "").trim().toLowerCase();
}

export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

export function isValidSchoolId(v) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(String(v || ""));
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      document.body.removeChild(ta);
      return false;
    }
  }
}

export function allowedCreateRoles(actorRole) {
  const r = String(actorRole || "").toUpperCase();
  if (r === "SYSTEM_ADMIN") return ["ADMIN", "TEACHER", "STUDENT"];
  if (r === "ADMIN") return ["TEACHER", "STUDENT"];
  return [];
}

export function allowedEditRoles(actorRole) {
  return allowedCreateRoles(actorRole);
}
