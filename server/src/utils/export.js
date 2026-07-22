import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";

// Prevents CSV/XLSX formula injection: a cell value that opens with =, +, -, @,
// or a tab/CR (all of which Excel/Sheets/LibreOffice will interpret as the start
// of a formula) is prefixed with a leading apostrophe so it's forced back to plain
// text on open. Applies to any string field that ends up in an export — several of
// which (student names, actor emails, user-agent strings, free-text references) are
// attacker-influenced. See OWASP "CSV Injection".
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function sanitizeCell(v) {
  if (typeof v !== "string") return v;
  return FORMULA_TRIGGER.test(v) ? `'${v}` : v;
}

function sanitizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = sanitizeCell(v);
  return out;
}

export function exportCSV(res, filename, rows) {
  const safeRows = (rows || []).map(sanitizeRow);
  const csv = stringify(safeRows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

export async function exportXLSX(res, filename, sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  ws.columns = columns;
  (rows || []).forEach((r) => ws.addRow(sanitizeRow(r)));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);

  await wb.xlsx.write(res);
  res.end();
}
