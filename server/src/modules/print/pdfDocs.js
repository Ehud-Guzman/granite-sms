// src/modules/print/pdfDocs.js
// One-page A4 PDFs on the school's letterhead: the exam result slip and the
// term report card. Built on the server so a download always looks the same
// and always fits one page, whatever the browser or phone.
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { getSchoolCalendar } from "../../utils/schoolTime.js";

const A4 = { width: 595.28, height: 841.89 };
const M = 40; // page margin
const W = A4.width - M * 2;
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const SHADE = "#f3f4f6";

const fmtDate = (d, timeZone) =>
  new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
const fmtNum = (n, dp = 1) => (n == null || n === "" ? "—" : Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(dp));
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
// "Mid-Term exam, Term 3" -> "Mid-Term": short enough for a column heading.
const shortExam = (name) => String(name || "Exam").replace(/,.*$/, "").replace(/\s+exam$/i, "").slice(0, 10);

export const safeFilePart = (s) => String(s || "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";

/** Everything the letterhead needs, in one read. */
export async function loadLetterhead(schoolId) {
  const [school, settings, logo, cal] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, contactEmail: true, contactPhone: true } }),
    prisma.schoolSettings.findUnique({ where: { schoolId }, select: { printShowLogo: true, printHeaderText: true, printFooterText: true } }),
    prisma.schoolLogo.findUnique({ where: { schoolId }, select: { mime: true, data: true } }),
    getSchoolCalendar(schoolId),
  ]);
  // pdfkit draws PNG and JPEG only.
  const usableLogo = settings?.printShowLogo !== false && logo && /image\/(png|jpe?g)/i.test(logo.mime) ? Buffer.from(logo.data) : null;
  return {
    name: school?.name || "School",
    header: settings?.printHeaderText || "",
    footer: settings?.printFooterText || "",
    contact: [school?.contactPhone, school?.contactEmail].filter(Boolean).join(" · "),
    logo: usableLogo,
    termLabels: cal.termLabels || {},
    timezone: cal.timezone,
  };
}

/** Starts a PDF download on the response. */
export function startPdf(res, filename) {
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: filename.replace(/\.pdf$/, "") } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function letterhead(doc, lh, title, subtitle) {
  let y = M;
  if (lh.logo) {
    try {
      doc.image(lh.logo, A4.width / 2 - 22, y, { fit: [44, 44], align: "center" });
      y += 50;
    } catch {
      // A logo pdfkit can't read is skipped, not fatal.
    }
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(lh.name.toUpperCase(), M, y, { width: W, align: "center" });
  y = doc.y + 2;
  if (lh.header) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(lh.header, M, y, { width: W, align: "center" });
    y = doc.y;
  }
  if (lh.contact) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(lh.contact, M, y + 1, { width: W, align: "center" });
    y = doc.y;
  }
  y += 8;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.2).strokeColor(INK).stroke();
  y += 10;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(title, M, y, { width: W, align: "center" });
  if (subtitle) doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(subtitle, M, doc.y + 1, { width: W, align: "center" });
  return doc.y + 12;
}

/** Two columns of "Label: value" pairs. */
function facts(doc, y, pairs) {
  const colW = W / 2;
  const rows = Math.ceil(pairs.length / 2);
  pairs.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * 15;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`${label}: `, x, yy, { continued: true });
    doc.font("Helvetica").text(String(value ?? "—"));
  });
  return y + rows * 15 + 6;
}

/**
 * A ruled table that fits the space left on the page: rows shrink (down to a
 * floor) rather than spill onto a second page.
 */
function table(doc, y, { columns, rows, footRows = [], maxHeight }) {
  const all = rows.length + footRows.length + 1;
  const rowH = Math.max(13, Math.min(20, maxHeight / all));
  const size = rowH >= 17 ? 9.5 : rowH >= 15 ? 8.5 : 7.5;
  const widths = columns.map((c) => c.width);
  const flexIdx = columns.findIndex((c) => c.flex);
  if (flexIdx >= 0) widths[flexIdx] = W - widths.reduce((a, b, i) => (i === flexIdx ? a : a + b), 0);

  const drawRow = (cells, yy, { bold = false, shade = false } = {}) => {
    if (shade) doc.rect(M, yy, W, rowH).fill(SHADE);
    let x = M;
    cells.forEach((cell, i) => {
      const col = columns[i];
      doc.fillColor(INK).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      doc.text(String(cell ?? ""), x + 5, yy + (rowH - size) / 2 - 1, { width: widths[i] - 10, align: col.align || "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.moveTo(M, yy + rowH).lineTo(M + W, yy + rowH).lineWidth(0.5).strokeColor(RULE).stroke();
  };

  drawRow(columns.map((c) => c.label), y, { bold: true, shade: true });
  let yy = y + rowH;
  for (const r of rows) {
    drawRow(r, yy);
    yy += rowH;
  }
  for (const r of footRows) {
    drawRow(r, yy, { bold: true });
    yy += rowH;
  }
  doc.rect(M, y, W, yy - y).lineWidth(0.8).strokeColor(RULE).stroke();
  return yy + 12;
}

/** Signature lines, the printed date and the school's footer, pinned to the bottom. */
function closing(doc, lh, signatures) {
  const bottom = A4.height - M;
  const sigY = bottom - 70;
  const colW = W / signatures.length;
  signatures.forEach((label, i) => {
    const x = M + i * colW;
    doc.moveTo(x + 6, sigY).lineTo(x + colW - 18, sigY).lineWidth(0.7).strokeColor(INK).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(label, x + 6, sigY + 4, { width: colW - 24 });
  });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
  doc.text(`Printed ${fmtDate(new Date(), lh.timezone)}`, M, bottom - 30, { width: W / 2 });
  if (lh.footer) doc.text(lh.footer, M + W / 2, bottom - 30, { width: W / 2, align: "right" });
}

function noteBox(doc, y, label, text, height) {
  doc.rect(M, y, W, height).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(label, M + 8, y + 6);
  doc.font("Helvetica").fontSize(9).fillColor(text ? INK : MUTED).text(text || "", M + 8, doc.y + 2, { width: W - 16, height: height - 22, ellipsis: true });
  return y + height + 8;
}

/** One learner's result for one exam (data from getStudentResults). */
export function drawResultSlip(doc, lh, { payload, classLabel }) {
  const s = payload.session || {};
  const term = `${lh.termLabels[s.term] || s.term || ""} ${s.year || ""}`.trim();
  // Exam names usually carry the term already ("Mid-Term exam, Term 3").
  const termName = lh.termLabels[s.term] || s.term || "";
  const subtitle = s.name && termName && s.name.includes(termName) ? `${s.name} · ${s.year}` : [s.name, term].filter(Boolean).join(" · ");
  let y = letterhead(doc, lh, "Result slip", subtitle);
  y = facts(doc, y, [
    ["Learner", `${payload.student?.firstName || ""} ${payload.student?.lastName || ""}`.trim()],
    ["Admission no", payload.student?.admissionNo],
    ["Class", classLabel],
    ["Position", payload.position ? `${ordinal(payload.position)} of ${payload.outOf}` : "—"],
  ]);
  const scores = payload.subjectScores || [];
  const reserve = 70 + 95; // summary rows are in the table; signatures and footer below
  y = table(doc, y, {
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
    maxHeight: A4.height - M - reserve - y,
  });
  if (payload.missingCount) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${payload.missingCount} subject(s) without a mark.`, M, y - 6);
  }
  closing(doc, lh, ["Class teacher", "Head teacher / stamp", "Parent / guardian"]);
}

/** One learner's term report card (data from getStudentReportCard). */
export function drawReportCard(doc, lh, report) {
  const row = report.students[0];
  const term = `${lh.termLabels[report.term] || report.term} ${report.year}`;
  const cls = report.class ? `${report.class.name}${report.class.stream ? ` ${report.class.stream}` : ""}` : "—";
  let y = letterhead(doc, lh, "Report card", term);
  const att = row.attendance;
  y = facts(doc, y, [
    ["Learner", `${row.student.firstName} ${row.student.lastName}`.trim()],
    ["Admission no", row.student.admissionNo],
    ["Class", cls],
    ["Position", `${ordinal(row.position)} of ${report.outOf}`],
    ["Average", `${fmtNum(row.average, 2)} · grade ${row.overallGrade || "—"}${row.meanPoints != null ? ` · ${row.meanPoints} points` : ""}`],
    ["Attendance", att ? `${att.present + att.late} of ${att.total} days${att.ratePct != null ? ` (${att.ratePct}%)` : ""}` : "—"],
  ]);

  const sessions = report.sessions.slice(0, 4);
  const columns = [
    { label: "Subject", width: 140 },
    ...sessions.map((s) => ({ label: shortExam(s.name), width: 56, align: "right" })),
    { label: "Term", width: 44, align: "right" },
    { label: "Grade", width: 40, align: "center" },
    { label: "Remark", flex: true },
  ];
  const reserve = 34 + 2 * 62 + 95; // weights line, two comment boxes, closing
  y = table(doc, y, {
    columns,
    rows: row.subjects.map((sub) => [
      sub.subjectName,
      ...sessions.map((s) => (sub.perSession[s.id] == null ? "—" : fmtNum(sub.perSession[s.id]))),
      sub.termScore == null ? "—" : fmtNum(sub.termScore),
      sub.grade || "—",
      sub.remark || "",
    ]),
    maxHeight: A4.height - M - reserve - y,
  });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
    `Exams combined by weight: ${report.sessions.map((s) => `${s.name} ×${s.weight}`).join(", ")}. Grading: ${report.gradeScale?.name || "school scale"}.`,
    M,
    y - 6,
    { width: W }
  );
  y = doc.y + 8;
  y = noteBox(doc, y, "Class teacher's comment", row.comments.classTeacher, 54);
  noteBox(doc, y, "Head teacher's comment", row.comments.head, 54);
  closing(doc, lh, ["Class teacher", "Head teacher / stamp", "Parent / guardian"]);
}
