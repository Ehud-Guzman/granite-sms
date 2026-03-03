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
  let score = null;

  if (typeof cell === "object") {
    score = cell.score ?? null;
  } else if (typeof cell === "number") {
    score = cell;
  }

  if (score === null) return null;

  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
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
