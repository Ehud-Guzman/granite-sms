// src/utils/studentFields.js
// Student fields are checked, not just stored (audit M17: "banana" was a
// gender and 2099 a birth date). Returns { value } or { error }.
const GENDERS = { M: "MALE", MALE: "MALE", BOY: "MALE", F: "FEMALE", FEMALE: "FEMALE", GIRL: "FEMALE" };
export function parseGender(v) {
  if (v == null || String(v).trim() === "") return { value: null };
  const g = GENDERS[String(v).trim().toUpperCase()];
  return g ? { value: g } : { error: "gender must be MALE or FEMALE" };
}
export function parseDob(v) {
  if (v == null || v === "") return { value: null };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { error: "dob must be a date (YYYY-MM-DD)" };
  if (d > new Date()) return { error: "dob can't be in the future" };
  if (d.getUTCFullYear() < 1950) return { error: "dob looks wrong (before 1950)" };
  return { value: d };
}
export function checkNames({ admissionNo, firstName, lastName }) {
  if (admissionNo != null && String(admissionNo).length > 30) return "admissionNo is too long (max 30)";
  for (const [k, v] of [["firstName", firstName], ["lastName", lastName]]) {
    if (v != null && String(v).length > 60) return `${k} is too long (max 60)`;
  }
  return null;
}
