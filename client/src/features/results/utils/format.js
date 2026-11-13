export function fmtClass(c) {
  if (!c) return "-";
  return `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`;
}

export function fmtStudentName(s) {
  const first = s?.firstName || "";
  const last = s?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

export function fmtPrintedAt(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
  } catch {
    return "";
  }
}
