// src/modules/print/tableReport.js
// Any report as a PDF: the tables a report shows on screen, drawn on the
// school's letterhead (Settings > Branding), headings repeated on each page.
// POST /api/print/table { title, subtitle?, tables: [{ caption?, columns, rows }] }
import { Router } from "express";
import { requireRole } from "../../middleware/auth.js";
import { loadLetterhead, letterhead, safeFilePart, startPdf } from "./pdfDocs.js";

const router = Router();
const MUTED = "#6b7280";
const INK = "#111827";
const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const NUMERIC = /^(KES\s*)?[-+]?[\d,]+(\.\d+)?%?$/;

function tint(hex, amount) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return "#f3f4f6";
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

router.post("/table", requireRole("ADMIN", "BURSAR", "TEACHER", "SYSTEM_ADMIN"), async (req, res) => {
  const b = req.body || {};
  const title = clip(b.title, 80) || "Report";
  const subtitle = clip(b.subtitle, 160);
  const tables = (Array.isArray(b.tables) ? b.tables : []).slice(0, 10).map((t) => ({
    caption: clip(t?.caption, 80),
    columns: (Array.isArray(t?.columns) ? t.columns : []).slice(0, 12).map((c) => clip(c, 40)),
    rows: (Array.isArray(t?.rows) ? t.rows : []).slice(0, 5000).map((r) => (Array.isArray(r) ? r : []).slice(0, 12).map((c) => clip(c, 120))),
  }));
  if (!tables.some((t) => t.columns.length && t.rows.length)) return res.status(400).json({ message: "Nothing to put in the PDF." });

  const lh = await loadLetterhead(req.schoolId);
  const doc = startPdf(res, `${safeFilePart(title)}.pdf`);
  const F = lh.font;
  const M = 40;
  const pageW = () => doc.page.width - M * 2;
  const bottom = () => doc.page.height - M - 24;
  let y = letterhead(doc, lh, title, subtitle);

  const footer = () => {
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(F.regular).fontSize(7.5).fillColor(MUTED);
    doc.text(`${lh.name} · ${title}`, M, doc.page.height - M - 8, { width: pageW() / 2, lineBreak: false });
    doc.text(`Printed ${new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: lh.timezone }).format(new Date())}`, M + pageW() / 2, doc.page.height - M - 8, { width: pageW() / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = keep;
  };
  const newPage = () => {
    footer();
    doc.addPage({ size: "A4", margin: M });
    y = M;
  };

  for (const t of tables) {
    if (!t.columns.length) continue;
    const n = t.columns.length;
    // Column widths from content length, within bounds.
    const len = t.columns.map((c, i) => Math.max(c.length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length)));
    const weights = len.map((l) => Math.min(Math.max(l, 4), 40));
    const total = weights.reduce((a, w) => a + w, 0);
    const widths = weights.map((w) => (w / total) * pageW());
    const numeric = t.columns.map((_, i) => t.rows.length && t.rows.slice(0, 50).every((r) => !r[i] || NUMERIC.test(String(r[i]).replace(/\s/g, ""))));
    const rowH = 18;

    const head = () => {
      doc.rect(M, y, pageW(), rowH + 2).fill(tint(lh.accent, 0.86));
      let x = M;
      t.columns.forEach((c, i) => {
        doc.fillColor(INK).font(F.bold).fontSize(8.5).text(c, x + 4, y + 6, { width: widths[i] - 8, align: numeric[i] ? "right" : "left", lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      y += rowH + 2;
    };

    if (y + 60 > bottom()) newPage();
    if (t.caption) {
      doc.fillColor(INK).font(F.bold).fontSize(11).text(t.caption, M, y, { width: pageW() });
      y = doc.y + 6;
    }
    head();
    t.rows.forEach((r, ri) => {
      if (y + rowH > bottom()) {
        newPage();
        head();
      }
      if (ri % 2 === 1) doc.rect(M, y, pageW(), rowH).fill(tint(lh.accent, 0.95));
      let x = M;
      for (let i = 0; i < n; i++) {
        doc.fillColor(INK).font(F.regular).fontSize(8.5).text(String(r[i] ?? ""), x + 4, y + 5, { width: widths[i] - 8, align: numeric[i] ? "right" : "left", lineBreak: false, ellipsis: true });
        x += widths[i];
      }
      y += rowH;
    });
    doc.moveTo(M, y).lineTo(M + pageW(), y).lineWidth(0.6).strokeColor("#d1d5db").stroke();
    doc.font(F.regular).fontSize(8).fillColor(MUTED).text(`${t.rows.length} row${t.rows.length === 1 ? "" : "s"}`, M, y + 4, { width: pageW(), align: "right" });
    y = doc.y + 16;
  }
  footer();
  doc.end();
});

export default router;
