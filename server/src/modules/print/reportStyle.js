// How a school's report cards and result slips look. Stored as one JSON value
// on SchoolSettings.reportStyle; anything missing falls back to the defaults
// here, so old schools and partial saves always print something sensible.

export const LAYOUTS = ["classic", "modern", "compact"];
export const FONTS = ["sans", "serif"];

export const SHOW_KEYS = [
  "position", // "3rd of 42"
  "attendance", // days present this term (report card)
  "remarks", // per-subject remark column (report card)
  "examColumns", // one column per exam (report card)
  "gradingNote", // "Exams combined by weight…" line
  "classTeacherComment",
  "headComment",
  "feeBalance", // what the family owes, from the fees ledger
  "signatures",
  "printedDate",
];

export const DEFAULT_STYLE = Object.freeze({
  layout: "classic",
  font: "sans",
  accent: null, // null = the school's brand colour, else near-black
  motto: "",
  slipTitle: "Result slip",
  reportTitle: "Report card",
  closingNote: "", // e.g. "Next term opens on Monday 5 January 2027."
  signatures: ["Class teacher", "Head teacher / stamp", "Parent / guardian"],
  show: Object.freeze({
    position: true,
    attendance: true,
    remarks: true,
    examColumns: true,
    gradingNote: true,
    classTeacherComment: true,
    headComment: true,
    feeBalance: false,
    signatures: true,
    printedDate: true,
  }),
});

const HEX = /^#[0-9a-f]{6}$/i;
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Fills in defaults for a stored style (never throws: a bad stored value just
 * prints the defaults).
 */
export function resolveStyle(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  const show = { ...DEFAULT_STYLE.show };
  if (s.show && typeof s.show === "object") for (const k of SHOW_KEYS) if (typeof s.show[k] === "boolean") show[k] = s.show[k];
  const sigs = Array.isArray(s.signatures) ? s.signatures.map((x) => text(x, 40)).filter(Boolean).slice(0, 3) : null;
  return {
    layout: LAYOUTS.includes(s.layout) ? s.layout : DEFAULT_STYLE.layout,
    font: FONTS.includes(s.font) ? s.font : DEFAULT_STYLE.font,
    accent: HEX.test(s.accent || "") ? s.accent : null,
    motto: text(s.motto, 120),
    slipTitle: text(s.slipTitle, 40) || DEFAULT_STYLE.slipTitle,
    reportTitle: text(s.reportTitle, 40) || DEFAULT_STYLE.reportTitle,
    closingNote: text(s.closingNote, 240),
    signatures: sigs && sigs.length ? sigs : [...DEFAULT_STYLE.signatures],
    show,
  };
}

/**
 * Checks a style sent by the settings screen. Returns { style } ready to store,
 * or { error } naming the first problem.
 */
export function readStyle(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "reportStyle must be an object." };
  if (input.layout != null && !LAYOUTS.includes(input.layout)) return { error: `layout must be one of: ${LAYOUTS.join(", ")}.` };
  if (input.font != null && !FONTS.includes(input.font)) return { error: `font must be one of: ${FONTS.join(", ")}.` };
  if (input.accent != null && input.accent !== "" && !HEX.test(input.accent)) return { error: "accent must be a colour like #1d4ed8." };
  if (input.signatures != null) {
    if (!Array.isArray(input.signatures) || input.signatures.length > 3) return { error: "signatures must be a list of up to 3 labels." };
  }
  if (input.show != null) {
    if (typeof input.show !== "object" || Array.isArray(input.show)) return { error: "show must be an object." };
    for (const [k, v] of Object.entries(input.show)) {
      if (!SHOW_KEYS.includes(k)) return { error: `Unknown part to show: ${k}.` };
      if (typeof v !== "boolean") return { error: `show.${k} must be true or false.` };
    }
  }
  const style = resolveStyle(input);
  // An empty signature list means "no signature lines", not "the defaults".
  if (Array.isArray(input.signatures) && input.signatures.every((x) => !text(x, 40))) style.show.signatures = false;
  return { style };
}
