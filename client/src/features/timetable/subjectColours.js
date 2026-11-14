// A colour per subject, the same in every class and on every screen, so a
// week scans at a glance. Eight tested categorical hues (light/dark steps);
// past eight, subjects share a neutral grey. The subject's name is always
// written in the cell, so colour is never the only way to tell them apart.
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const GREY = { light: "#94a3b8", dark: "#64748b" };

/** Map subjectId -> { light, dark } from every subject seen, ordered by name (stable). */
export function subjectColourMap(subjects) {
  const byId = new Map();
  for (const s of subjects) if (s?.id && !byId.has(s.id)) byId.set(s.id, s.name || "");
  const ordered = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return new Map(ordered.map(([id], i) => [id, i < LIGHT.length ? { light: LIGHT[i], dark: DARK[i] } : GREY]));
}

/** Inline style for a lesson cell: a coloured edge and a faint wash, text stays in text colours. */
export function lessonStyle(colour, isDark) {
  const c = colour ? (isDark ? colour.dark : colour.light) : isDark ? GREY.dark : GREY.light;
  return { borderLeft: `3px solid ${c}`, background: `${c}1a` };
}
