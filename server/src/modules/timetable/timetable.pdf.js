// src/modules/timetable/timetable.pdf.js
// A week's timetable on one landscape A4 page: days down the side, periods
// across, breaks as narrow shaded columns. Uses the school's letterhead,
// colour and lettering from Settings > Branding.
import PDFDocument from "pdfkit";
import { DAY_NAMES } from "./timetable.rules.js";

const PAGE = { width: 841.89, height: 595.28 };
const M = 30;
const W = PAGE.width - M * 2;
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";

function tint(hex, amount) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return "#f3f4f6";
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Streams the PDF to res.
 * opts: { filename, title, subtitle, setup: { days, periods }, lessons, cell(lesson) -> [line1, line2] }
 */
export function drawTimetablePdf(res, lh, { filename, title, subtitle, setup, lessons, cell }) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M, info: { Title: title } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  const F = lh.font;
  const accent = lh.accent;

  // Header: crest and name on the left, what this is on the right.
  let x = M;
  if (lh.logo) {
    try {
      doc.image(lh.logo, M, M - 6, { fit: [34, 34] });
      x = M + 42;
    } catch {
      /* unreadable logo: skip */
    }
  }
  doc.fillColor(INK).font(F.bold).fontSize(13).text(lh.name.toUpperCase(), x, M - 4, { width: W * 0.55 - (x - M) });
  const sub = [lh.style?.motto && `“${lh.style.motto}”`, lh.header].filter(Boolean).join(" · ");
  if (sub) doc.font(F.regular).fontSize(8).fillColor(MUTED).text(sub, x, doc.y + 1, { width: W * 0.55 - (x - M) });
  doc.fillColor(accent).font(F.bold).fontSize(13).text(title, M + W * 0.45, M - 4, { width: W * 0.55, align: "right" });
  if (subtitle) doc.font(F.regular).fontSize(9).fillColor(MUTED).text(subtitle, M + W * 0.45, doc.y + 1, { width: W * 0.55, align: "right" });
  let y = Math.max(doc.y, M + 32) + 6;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.2).strokeColor(accent).stroke();
  y += 10;

  // Grid geometry: a day column, then periods; breaks get a narrow column.
  const periods = setup.periods;
  const dayW = 62;
  const breakW = 24;
  const nBreaks = periods.filter((p) => p.kind === "BREAK").length;
  const nLessons = periods.length - nBreaks;
  const lessonW = nLessons ? (W - dayW - breakW * nBreaks) / nLessons : 0;
  const colX = [];
  let cx = M + dayW;
  for (const p of periods) {
    colX.push(cx);
    cx += p.kind === "BREAK" ? breakW : lessonW;
  }
  const headH = 30;
  const bottom = PAGE.height - M - 18;
  const rowH = Math.min(78, (bottom - y - headH) / Math.max(1, setup.days.length));
  // Parallel group lessons share a slot: shown together ("CRE / IRE").
  const byKey = new Map();
  for (const l of lessons) byKey.set(`${l.day}|${l.periodId}`, [...(byKey.get(`${l.day}|${l.periodId}`) || []), l]);

  // Header row: period name and times.
  doc.rect(M, y, W, headH).fill(tint(accent, 0.86));
  doc.fillColor(INK).font(F.bold).fontSize(8.5).text("Day", M + 6, y + 10, { width: dayW - 8 });
  periods.forEach((p, i) => {
    const w = p.kind === "BREAK" ? breakW : lessonW;
    if (p.kind === "BREAK") return;
    doc.fillColor(INK).font(F.bold).fontSize(8.5).text(p.label, colX[i] + 2, y + 5, { width: w - 4, align: "center", lineBreak: false, ellipsis: true });
    doc.font(F.regular).fontSize(7).fillColor(MUTED).text(`${p.startsAt}-${p.endsAt}`, colX[i] + 2, y + 17, { width: w - 4, align: "center", lineBreak: false });
  });

  // Day rows.
  const gridTop = y;
  y += headH;
  for (const day of setup.days) {
    doc.font(F.bold).fontSize(9).fillColor(INK).text(DAY_NAMES[day], M + 6, y + rowH / 2 - 5, { width: dayW - 8 });
    periods.forEach((p, i) => {
      if (p.kind === "BREAK") return;
      // A period that doesn't run on this day (e.g. games day): shaded, not an empty slot.
      if (p.days?.length && !p.days.includes(day)) {
        doc.rect(colX[i], y, lessonW, rowH).fill("#f3f4f6");
        return;
      }
      const ls = byKey.get(`${day}|${p.id}`);
      if (!ls?.length) return;
      const w = lessonW;
      doc.rect(colX[i] + 2, y + 2, w - 4, rowH - 4).fill(tint(accent, 0.93));
      const parts = ls.map(cell);
      const a = parts.map((x) => x[0]).join(" / ");
      const b = parts.map((x) => x[1]).filter(Boolean).join(" / ");
      const size = lessonW < 60 ? 7 : 8.5;
      doc.fillColor(INK).font(F.bold).fontSize(size).text(a || "", colX[i] + 5, y + 7, { width: w - 10, height: rowH / 2, ellipsis: true });
      if (b) doc.fillColor(MUTED).font(F.regular).fontSize(size - 1.5).text(b, colX[i] + 5, doc.y + 1, { width: w - 10, height: rowH / 2 - 6, ellipsis: true });
    });
    y += rowH;
    doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  // Breaks: shaded columns with their name written up the column.
  periods.forEach((p, i) => {
    if (p.kind !== "BREAK") return;
    doc.rect(colX[i], gridTop, breakW, y - gridTop).fill("#f3f4f6");
    doc.save();
    doc.rotate(-90, { origin: [colX[i] + breakW / 2, (gridTop + y) / 2] });
    doc.fillColor(MUTED).font(F.regular).fontSize(7.5).text(`${p.label}  ${p.startsAt}-${p.endsAt}`, colX[i] + breakW / 2 - (y - gridTop) / 2, (gridTop + y) / 2 - 4, {
      width: y - gridTop,
      align: "center",
      lineBreak: false,
    });
    doc.restore();
  });
  // Column rules and the frame.
  for (const cxi of [M + dayW, ...colX.slice(1)]) doc.moveTo(cxi, gridTop).lineTo(cxi, y).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.rect(M, gridTop, W, y - gridTop).lineWidth(0.8).strokeColor(RULE).stroke();

  // Footer, in the bottom margin (pdfkit would otherwise start a new page).
  doc.page.margins.bottom = 0;
  const printed = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: lh.timezone }).format(new Date());
  doc.font(F.regular).fontSize(7.5).fillColor(MUTED).text(`Printed ${printed}`, M, PAGE.height - M - 8, { width: W / 2, lineBreak: false });
  if (lh.footer) doc.text(lh.footer, M + W / 2, PAGE.height - M - 8, { width: W / 2, align: "right", lineBreak: false });
  doc.end();
}
