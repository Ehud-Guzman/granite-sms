// src/utils/phone.js
// Kenyan mobile numbers in one form, +2547XXXXXXXX / +2541XXXXXXXX, so the
// same parent typed as 0712 345 678 or 254712345678 is one person, and SMS /
// M-Pesa integrations later get a number they accept.

/** Returns "+254XXXXXXXXX" or null if it isn't a Kenyan mobile number. */
export function normalizeKenyanPhone(raw) {
  let d = String(raw || "").replace(/[\s()-]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (/^0[17]\d{8}$/.test(d)) d = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) d = `254${d}`;
  return /^254[17]\d{8}$/.test(d) ? `+${d}` : null;
}

/**
 * Accepts any international number written with a leading "+" (8–15 digits,
 * for parents abroad); otherwise it must be a Kenyan mobile.
 */
export function normalizePhone(raw) {
  const ke = normalizeKenyanPhone(raw);
  if (ke) return ke;
  const d = String(raw || "").replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}
