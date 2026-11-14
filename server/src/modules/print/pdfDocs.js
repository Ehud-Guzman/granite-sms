// src/modules/print/pdfDocs.js
// One-page A4 PDFs on the school's letterhead: the exam result slip and the
// term report card. Built on the server so a download always looks the same
// and always fits one page, whatever the browser or phone. How they look
// (layout, colour, wording, which parts show) is the school's choice; see
// reportStyle.js.
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { getSchoolCalendar } from "../../utils/schoolTime.js";
import { resolveStyle } from "./reportStyle.js";

const A4 = { width: 595.28, height: 841.89 };
const M = 40; // page margin
const W = A4.width - M * 2;
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const HEX = /^#[0-9a-f]{6}$/i;

const fmtDate = (d, timeZone) =>
  new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
const fmtNum = (n, dp = 1) => (n == null || n === "" ? "—" : Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(dp));
const fmtMoney = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
// "Mid-Term exam, Term 3" -> "Mid-Term": short enough for a column heading.
const shortExam = (name) => String(name || "Exam").replace(/,.*$/, "").replace(/\s+exam$/i, "").slice(0, 10);

/** The accent mixed with white: 0 = accent, 1 = white. For table headers and bands. */
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const safeFilePart = (s) => String(s || "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";

/**
 * Everything the letterhead needs, in one read. `override` (from the settings
 * preview) replaces the saved print fields and style without storing them.
 */
export async function loadLetterhead(schoolId, override = null) {
  const [school, settings, logo, cal] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, contactEmail: true, contactPhone: true } }),
    prisma.schoolSettings.findUnique({
      where: { schoolId },
      select: { printShowLogo: true, printHeaderText: true, printFooterText: true, reportStyle: true, brandPrimaryColor: true, brandSecondaryColor: true },
    }),
    prisma.schoolLogo.findUnique({ where: { schoolId }, select: { mime: true, data: true } }),
    getSchoolCalendar(schoolId),
  ]);
  const p = { ...settings, ...(override || {}) };
  const style = resolveStyle(override?.reportStyle ?? settings?.reportStyle);
  // pdfkit draws PNG and JPEG only.
  const usableLogo = p.printShowLogo !== false && logo && /image\/(png|jpe?g)/i.test(logo.mime) ? Buffer.from(logo.data) : null;
  // The school's main colour (stored as brandSecondaryColor: it's the one on
  // the app's buttons), else its accent colour.
  const brand = [settings?.brandSecondaryColor, settings?.brandPrimaryColor].find((c) => HEX.test(c || "")) || null;
  return {
    name: school?.name || "School",
    header: p.printHeaderText || "",
    footer: p.printFooterText || "",
    contact: [school?.contactPhone, school?.contactEmail].filter(Boolean).join(" · "),
    logo: usableLogo,
    termLabels: cal.termLabels || {},
    timezone: cal.timezone,
    style,
    accent: style.accent || brand || INK,
    font: style.font === "serif" ? { regular: "Times-Roman", bold: "Times-Bold" } : { regular: "Helvetica", bold: "Helvetica-Bold" },
  };
}

/** Starts a PDF download on the response. */
export function startPdf(res, filename, { inline = false } = {}) {
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: filename.replace(/\.pdf$/, "") } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function drawLogo(doc, lh, x, y, size) {
  if (!lh.logo) return false;
  try {
    doc.image(lh.logo, x, y, { fit: [size, size], align: "center", valign: "center" });
    return true;
  } catch {
    return false; // a logo pdfkit can't read is skipped, not fatal
  }
}

/** The top of the page in the school's chosen layout. Returns the y to continue from. */
export function letterhead(doc, lh, title, subtitle) {
  const { layout, motto } = lh.style;
  const F = lh.font;
  const sub = [lh.header, lh.contact].filter(Boolean);

  if (layout === "modern") {
    // A band of the accent colour across the top, white lettering on it.
    const bandH = 84;
    doc.rect(0, 0, A4.width, bandH).fill(lh.accent);
    let x = M;
    if (lh.logo) {
      doc.circle(M + 26, bandH / 2, 27).fill("#ffffff");
      if (drawLogo(doc, lh, M + 6, bandH / 2 - 20, 40)) x = M + 64;
    }
    doc.fillColor("#ffffff").font(F.bold).fontSize(16).text(lh.name.toUpperCase(), x, 20, { width: W - (x - M) });
    let yy = doc.y + 1;
    if (motto) {
      doc.font(F.regular).fontSize(9).fillColor(tint(lh.accent, 0.8)).text(`“${motto}”`, x, yy, { width: W - (x - M) });
      yy = doc.y;
    }
    if (sub.length) doc.font(F.regular).fontSize(8).fillColor(tint(lh.accent, 0.8)).text(sub.join(" · "), x, yy + 1, { width: W - (x - M) });
    let y = bandH + 16;
    doc.fillColor(lh.accent).font(F.bold).fontSize(15).text(title.toUpperCase(), M, y, { width: W, characterSpacing: 1 });
    if (subtitle) doc.font(F.regular).fontSize(9.5).fillColor(MUTED).text(subtitle, M, doc.y + 1, { width: W });
    y = doc.y + 6;
    doc.moveTo(M, y).lineTo(M + 60, y).lineWidth(2).strokeColor(lh.accent).stroke();
    return y + 12;
  }

  if (layout === "compact") {
    // Logo and name on one line, the title on the right: more room for marks.
    const top = M - 8;
    let x = M;
    if (drawLogo(doc, lh, M, top, 36)) x = M + 44;
    doc.fillColor(INK).font(F.bold).fontSize(12.5).text(lh.name.toUpperCase(), x, top + 1, { width: W * 0.62 - (x - M) });
    const lines = [motto && `“${motto}”`, ...sub].filter(Boolean);
    if (lines.length) doc.font(F.regular).fontSize(7.5).fillColor(MUTED).text(lines.join(" · "), x, doc.y + 1, { width: W * 0.62 - (x - M) });
    const leftBottom = doc.y;
    doc.fillColor(lh.accent).font(F.bold).fontSize(12).text(title, M + W * 0.62, top + 1, { width: W * 0.38, align: "right" });
    if (subtitle) doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(subtitle, M + W * 0.62, doc.y + 1, { width: W * 0.38, align: "right" });
    const y = Math.max(leftBottom, doc.y, top + 36) + 6;
    doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1).strokeColor(lh.accent).stroke();
    return y + 10;
  }

  // classic: everything centred under the crest.
  let y = M;
  if (drawLogo(doc, lh, A4.width / 2 - 22, y, 44)) y += 50;
  doc.fillColor(INK).font(F.bold).fontSize(15).text(lh.name.toUpperCase(), M, y, { width: W, align: "center" });
  y = doc.y + 1;
  if (motto) {
    doc.font(F.regular).fontSize(9).fillColor(lh.accent).text(`“${motto}”`, M, y, { width: W, align: "center" });
    y = doc.y;
  }
  for (const line of sub) {
    doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(line, M, y + 1, { width: W, align: "center" });
    y = doc.y;
  }
  y += 8;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.4).strokeColor(lh.accent).stroke();
  doc.moveTo(M, y + 2.5).lineTo(M + W, y + 2.5).lineWidth(0.5).strokeColor(lh.accent).stroke();
  y += 12;
  doc.fillColor(INK).font(F.bold).fontSize(13).text(title.toUpperCase(), M, y, { width: W, align: "center", characterSpacing: 0.8 });
  if (subtitle) doc.font(F.regular).fontSize(9.5).fillColor(MUTED).text(subtitle, M, doc.y + 1, { width: W, align: "center" });
  return doc.y + 12;
}

/** Two columns of "Label: value" pairs. */
function facts(doc, lh, y, pairs) {
  const colW = W / 2;
  const rows = Math.ceil(pairs.length / 2);
  const step = lh.style.layout === "compact" ? 13 : 15;
  pairs.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * step;
    doc.font(lh.font.bold).fontSize(9).fillColor(INK).text(`${label}: `, x, yy, { continued: true });
    doc.font(lh.font.regular).text(String(value ?? "—"));
  });
  return y + rows * step + 6;
}

/**
 * A ruled table that fits the space left on the page: rows shrink (down to a
 * floor) rather than spill onto a second page.
 */
function table(doc, lh, y, { columns, rows, footRows = [], maxHeight }) {
  const all = rows.length + footRows.length + 1;
  const maxRow = lh.style.layout === "compact" ? 18 : 24;
  const rowH = Math.max(13, Math.min(maxRow, maxHeight / all));
  const size = rowH >= 17 ? 9.5 : rowH >= 15 ? 8.5 : 7.5;
  const widths = columns.map((c) => c.width);
  const flexIdx = columns.findIndex((c) => c.flex);
  if (flexIdx >= 0) widths[flexIdx] = W - widths.reduce((a, b, i) => (i === flexIdx ? a : a + b), 0);
  const solidHead = lh.style.layout === "modern";
  const stripe = tint(lh.accent, 0.94);

  const drawRow = (cells, yy, { head = false, bold = false, shade = null } = {}) => {
    if (head) doc.rect(M, yy, W, rowH).fill(solidHead ? lh.accent : tint(lh.accent, 0.86));
    else if (shade) doc.rect(M, yy, W, rowH).fill(shade);
    let x = M;
    cells.forEach((cell, i) => {
      const col = columns[i];
      doc.fillColor(head && solidHead ? "#ffffff" : INK).font(head || bold ? lh.font.bold : lh.font.regular).fontSize(size);
      doc.text(String(cell ?? ""), x + 5, yy + (rowH - size) / 2 - 1, { width: widths[i] - 10, align: col.align || "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.moveTo(M, yy + rowH).lineTo(M + W, yy + rowH).lineWidth(0.5).strokeColor(RULE).stroke();
  };

  drawRow(columns.map((c) => c.label), y, { head: true });
  let yy = y + rowH;
  rows.forEach((r, i) => {
    // Modern stripes every other row so long tables are easy to follow.
    drawRow(r, yy, { shade: solidHead && i % 2 === 1 ? stripe : null });
    yy += rowH;
  });
  for (const r of footRows) {
    drawRow(r, yy, { bold: true, shade: tint(lh.accent, 0.92) });
    yy += rowH;
  }
  doc.rect(M, y, W, yy - y).lineWidth(0.8).strokeColor(RULE).stroke();
  return yy + 12;
}

/** Space the bottom of the page needs: closing note, signatures, footer. */
function closingHeight(lh) {
  const { show, closingNote } = lh.style;
  return 34 + (show.signatures ? 40 : 0) + (closingNote ? 30 : 0);
}

/** Closing note, signature lines, the printed date and the footer, pinned to the bottom. */
function closing(doc, lh) {
  const { show, signatures, closingNote } = lh.style;
  const bottom = A4.height - M;
  let y = bottom - closingHeight(lh) + 4;
  if (closingNote) {
    doc.rect(M, y, W, 22).fill(tint(lh.accent, 0.9));
    doc.font(lh.font.bold).fontSize(8.5).fillColor(INK).text(closingNote, M + 8, y + 7, { width: W - 16, lineBreak: false, ellipsis: true });
    y += 30;
  }
  if (show.signatures && signatures.length) {
    const sigY = y + 22;
    const colW = W / signatures.length;
    signatures.forEach((label, i) => {
      const x = M + i * colW;
      doc.moveTo(x + 6, sigY).lineTo(x + colW - 18, sigY).lineWidth(0.7).strokeColor(INK).stroke();
      doc.font(lh.font.regular).fontSize(8.5).fillColor(MUTED).text(label, x + 6, sigY + 4, { width: colW - 24 });
    });
  }
  doc.font(lh.font.regular).fontSize(7.5).fillColor(MUTED);
  if (show.printedDate) doc.text(`Printed ${fmtDate(new Date(), lh.timezone)}`, M, bottom - 12, { width: W / 2 });
  if (lh.footer) doc.text(lh.footer, M + W / 2, bottom - 12, { width: W / 2, align: "right" });
}

/** The key figures as tiles across the page (accent-tinted, value large). */
function tiles(doc, lh, y, items) {
  const list = items.filter(Boolean);
  if (!list.length) return y;
  const gap = 8;
  const w = (W - gap * (list.length - 1)) / list.length;
  const h = 44;
  list.forEach(([label, value, sub], i) => {
    const x = M + i * (w + gap);
    doc.roundedRect(x, y, w, h, 6).fill(tint(lh.accent, 0.9));
    doc.fillColor(MUTED).font(lh.font.regular).fontSize(7.5).text(label.toUpperCase(), x + 10, y + 7, { width: w - 20, characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(INK).font(lh.font.bold).fontSize(15).text(String(value ?? "—"), x + 10, y + 18, { width: w - 20, lineBreak: false, ellipsis: true, continued: !!sub });
    if (sub) doc.font(lh.font.regular).fontSize(8.5).fillColor(MUTED).text(`  ${sub}`, { lineBreak: false });
  });
  return y + h + 12;
}

function noteBox(doc, lh, y, label, text, height) {
  doc.rect(M, y, W, height).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.rect(M, y, 3, height).fill(lh.accent);
  doc.font(lh.font.bold).fontSize(8.5).fillColor(INK).text(label, M + 10, y + 6);
  doc.font(lh.font.regular).fontSize(9).fillColor(text ? INK : MUTED).text(text || "", M + 10, doc.y + 2, { width: W - 20, height: height - 22, ellipsis: true });
  return y + height + 8;
}

const feeLine = (n) => (n == null ? null : n > 0 ? `${fmtMoney(n)} owed` : n < 0 ? `${fmtMoney(-n)} in credit` : "Fully paid");

/**
 * One learner's result for one exam (data from getStudentResults).
 * extras.feeBalance: the family's net balance, when the school shows it.
 */
export function drawResultSlip(doc, lh, { payload, classLabel, extras = {} }) {
  const { show } = lh.style;
  const s = payload.session || {};
  const term = `${lh.termLabels[s.term] || s.term || ""} ${s.year || ""}`.trim();
  // Exam names usually carry the term already ("Mid-Term exam, Term 3").
  const termName = lh.termLabels[s.term] || s.term || "";
  const subtitle = s.name && termName && s.name.includes(termName) ? `${s.name} · ${s.year}` : [s.name, term].filter(Boolean).join(" · ");
  let y = letterhead(doc, lh, lh.style.slipTitle, subtitle);
  const pairs = [
    ["Learner", `${payload.student?.firstName || ""} ${payload.student?.lastName || ""}`.trim()],
    ["Admission no", payload.student?.admissionNo],
    ["Class", classLabel],
  ];
  if (show.feeBalance && extras.feeBalance !== undefined) pairs.push(["Fees", feeLine(extras.feeBalance)]);
  y = facts(doc, lh, y, pairs);
  y = tiles(doc, lh, y, [
    ["Total", fmtNum(payload.total)],
    ["Average", fmtNum(payload.average, 2)],
    ["Grade", payload.overallGrade || "—"],
    show.position && ["Position", payload.position ? ordinal(payload.position) : "—", payload.position ? `of ${payload.outOf}` : ""],
  ]);
  const scores = payload.subjectScores || [];
  y = table(doc, lh, y, {
    columns: [
      { label: "Subject", flex: true },
      { label: "Score", width: 70, align: "right" },
      { label: "Grade", width: 70, align: "center" },
    ],
    rows: scores.map((x) => [x.subjectName, x.score == null ? "—" : fmtNum(x.score), x.grade || "—"]),
    footRows: [
      ["Total", fmtNum(payload.total), ""],
      ["Average", fmtNum(payload.average, 2), payload.overallGrade || "—"],
    ],
    maxHeight: A4.height - M - closingHeight(lh) - 16 - y,
  });
  if (payload.missingCount) {
    doc.font(lh.font.regular).fontSize(8).fillColor(MUTED).text(`${payload.missingCount} subject(s) without a mark.`, M, y - 6);
  }
  closing(doc, lh);
}

/** One learner's term report card (data from getStudentReportCard). */
export function drawReportCard(doc, lh, report, extras = {}) {
  const { show } = lh.style;
  const row = report.students[0];
  const term = `${lh.termLabels[report.term] || report.term} ${report.year}`;
  const cls = report.class ? `${report.class.name}${report.class.stream ? ` ${report.class.stream}` : ""}` : "—";
  let y = letterhead(doc, lh, lh.style.reportTitle, term);
  const att = row.attendance;
  const pairs = [
    ["Learner", `${row.student.firstName} ${row.student.lastName}`.trim()],
    ["Admission no", row.student.admissionNo],
    ["Class", cls],
  ];
  if (show.feeBalance && extras.feeBalance !== undefined) pairs.push(["Fees", feeLine(extras.feeBalance)]);
  y = facts(doc, lh, y, pairs);
  y = tiles(doc, lh, y, [
    ["Average", fmtNum(row.average, 2), row.meanPoints != null ? `${row.meanPoints} pts` : ""],
    ["Grade", row.overallGrade || "—"],
    show.position && ["Position", ordinal(row.position), `of ${report.outOf}`],
    show.attendance && ["Attendance", att?.ratePct != null ? `${att.ratePct}%` : "—", att ? `${att.present + att.late}/${att.total} days` : ""],
  ]);

  const sessions = show.examColumns ? report.sessions.slice(0, 4) : [];
  const columns = [
    { label: "Subject", width: show.remarks ? 140 : 0, flex: !show.remarks },
    ...sessions.map((s) => ({ label: shortExam(s.name), width: 56, align: "right" })),
    { label: "Term", width: 50, align: "right" },
    { label: "Grade", width: 46, align: "center" },
    ...(show.remarks ? [{ label: "Remark", flex: true }] : []),
  ];
  const boxes = (show.classTeacherComment ? 62 : 0) + (show.headComment ? 62 : 0);
  const reserve = (show.gradingNote ? 22 : 4) + boxes + closingHeight(lh) + 16;
  y = table(doc, lh, y, {
    columns,
    rows: row.subjects.map((sub) => [
      sub.subjectName,
      ...sessions.map((s) => (sub.perSession[s.id] == null ? "—" : fmtNum(sub.perSession[s.id]))),
      sub.termScore == null ? "—" : fmtNum(sub.termScore),
      sub.grade || "—",
      ...(show.remarks ? [sub.remark || ""] : []),
    ]),
    maxHeight: A4.height - M - reserve - y,
  });
  if (show.gradingNote) {
    doc.font(lh.font.regular).fontSize(7.5).fillColor(MUTED).text(
      `Exams combined by weight: ${report.sessions.map((s) => `${s.name} ×${s.weight}`).join(", ")}. Grading: ${report.gradeScale?.name || "school scale"}.`,
      M,
      y - 6,
      { width: W }
    );
    y = doc.y + 8;
  }
  // Comment boxes share whatever room is left (no empty gap above the signatures).
  const nBoxes = (show.classTeacherComment ? 1 : 0) + (show.headComment ? 1 : 0);
  const room = A4.height - M - closingHeight(lh) - 12 - y;
  const boxH = nBoxes ? Math.max(54, Math.min(120, room / nBoxes - 8)) : 0;
  if (show.classTeacherComment) y = noteBox(doc, lh, y, "Class teacher's comment", row.comments.classTeacher, boxH);
  if (show.headComment) noteBox(doc, lh, y, "Head teacher's comment", row.comments.head, boxH);
  closing(doc, lh);
}

/* ------------------------------------------------------------------ */
/* Sample data for the settings preview                                */
/* ------------------------------------------------------------------ */

const SAMPLE_SUBJECTS = [
  ["Mathematics", 78, 82, 80, "B+", "Steady progress"],
  ["English", 71, 69, 72, "B", "Reads widely"],
  ["Kiswahili", 84, 88, 86, "A-", "Excellent"],
  ["Integrated Science", 66, 70, 69, "B-", "Keep revising"],
  ["Social Studies", 74, 77, 76, "B+", "Good work"],
  ["Pre-Technical Studies", 81, 79, 80, "B+", "Neat and careful"],
  ["Agriculture", 69, 73, 72, "B", "Practical work strong"],
  ["Creative Arts & Sports", 88, 85, 86, "A-", "Talented"],
  ["Religious Education", 77, 80, 79, "B+", "Good"],
];

/** A made-up learner, so a school can see its design before any exam is published. */
export function sampleSlip() {
  const scores = SAMPLE_SUBJECTS.map(([name, , b, , grade]) => ({ subjectName: name, score: b, grade }));
  const total = scores.reduce((a, s) => a + s.score, 0);
  return {
    payload: {
      session: { name: "Mid-Term exam, Term 3", term: "TERM3", year: new Date().getFullYear() },
      student: { firstName: "Amani", lastName: "Wanjiru", admissionNo: "1024" },
      position: 4,
      outOf: 38,
      subjectScores: scores,
      total,
      average: total / scores.length,
      overallGrade: "B+",
    },
    classLabel: "Grade 8 East",
    extras: { feeBalance: 4500 },
  };
}

export function sampleReport() {
  const sessions = [
    { id: "a", name: "Opener exam", weight: 0.2 },
    { id: "b", name: "Mid-Term exam", weight: 0.3 },
    { id: "c", name: "End-Term exam", weight: 0.5 },
  ];
  const subjects = SAMPLE_SUBJECTS.map(([name, a, b, term, grade, remark]) => ({
    subjectName: name,
    perSession: { a, b, c: term },
    termScore: term,
    grade,
    remark,
  }));
  return {
    report: {
      term: "TERM3",
      year: new Date().getFullYear(),
      class: { name: "Grade 8", stream: "East" },
      outOf: 38,
      sessions,
      gradeScale: { name: "CBE rubric" },
      students: [
        {
          student: { firstName: "Amani", lastName: "Wanjiru", admissionNo: "1024" },
          position: 4,
          average: subjects.reduce((x, s) => x + s.termScore, 0) / subjects.length,
          overallGrade: "B+",
          meanPoints: null,
          attendance: { present: 58, late: 2, total: 62, ratePct: 97 },
          subjects,
          comments: {
            classTeacher: "Amani works hard and helps others. Aim higher in Science next term.",
            head: "A good term. Keep it up.",
          },
        },
      ],
    },
    extras: { feeBalance: 4500 },
  };
}
