export function fmtClass(c) {
  if (!c) return "-";
  return `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`;
}

export function scoreFromCell(cell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object") return cell.score ?? null;
  return cell;
}

export function gradeFromCell(cell) {
  if (!cell || typeof cell !== "object") return null;
  return cell.grade ?? null;
}

export function fmtStudentName(s) {
  const first = s?.firstName || "";
  const last = s?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

export function fmtPrintedAt(d = new Date()) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
}
