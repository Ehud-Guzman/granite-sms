// src/routes/studentImport.js
// Bulk import of learners from Excel (.xlsx) or CSV (missing feature 8).
//
//   POST /api/students/import?dryRun=1   (ADMIN, multipart field "file")
//     -> { rows: [{ row, admissionNo, name, className, guardian, errors[] }], valid, invalid, created? }
//
// Validate first (dryRun) and show the errors; without dryRun the file is
// imported only if every row is valid, all in one transaction.
import { Router } from "express";
import multer from "multer";
import { Readable } from "stream";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { loadSubscription, effectiveCap } from "../middleware/subscription.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { parseGender, parseDob, checkNames } from "../utils/studentFields.js";
import { normalizePhone } from "../utils/phone.js";
import { getSchoolCalendar } from "../utils/schoolTime.js";

const router = Router();
router.use(requireTenant, loadSubscription);

const MAX_ROWS = 2000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });

// Column headings people actually use, mapped to our fields.
const HEADERS = {
  admissionNo: ["admission no", "admission number", "adm no", "adm", "admno", "admission", "adm. no"],
  firstName: ["first name", "firstname", "first", "given name", "other names"],
  lastName: ["last name", "lastname", "surname", "family name"],
  gender: ["gender", "sex"],
  dob: ["dob", "date of birth", "birth date", "birthday"],
  className: ["class", "grade", "form", "class name"],
  stream: ["stream"],
  guardianName: ["parent name", "guardian name", "parent", "guardian", "parent/guardian"],
  guardianPhone: ["parent phone", "guardian phone", "phone", "parent mobile", "mobile", "contact"],
  guardianRelationship: ["relationship", "parent relationship", "guardian relationship"],
};
const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
const key = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
  }
  return String(v).trim();
}

/** Reads the first sheet (xlsx) or the CSV into [{ rowNumber, values: {field: text} }]. */
async function readRows(file) {
  const wb = new ExcelJS.Workbook();
  const isXlsx = /\.xlsx$/i.test(file.originalname || "") || file.buffer.slice(0, 2).toString("hex") === "504b";
  const ws = isXlsx ? (await wb.xlsx.load(file.buffer), wb.worksheets[0]) : await wb.csv.read(Readable.from(file.buffer));
  if (!ws) return { error: "The file has no sheet." };

  const header = ws.getRow(1).values.slice(1).map(norm);
  const colOf = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) colOf[field] = idx + 1;
  }
  const missing = ["admissionNo", "firstName", "lastName"].filter((f) => !colOf[f]);
  if (missing.length) {
    return { error: `Missing column(s): ${missing.join(", ")}. The first row must hold column headings.` };
  }

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = {};
    for (const [field, col] of Object.entries(colOf)) values[field] = cellText(row.getCell(col).value);
    if (Object.values(values).every((v) => !v)) return; // blank line
    rows.push({ rowNumber, values });
  });
  return { rows };
}

/** 20/05/2014 (Kenyan day-first) or 2014-05-20 -> "2014-05-20"; anything else unchanged. */
function dayFirst(v) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(v).trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
}

router.post("/", requireRole("ADMIN"), upload.single("file"), async (req, res) => {
  const schoolId = req.schoolId;
  const dryRun = String(req.query.dryRun || "") === "1" || req.body?.dryRun === "true";
  if (!req.file) return res.status(400).json({ message: "Attach the file as 'file' (.xlsx or .csv)." });

  let parsed;
  try {
    parsed = await readRows(req.file);
  } catch {
    return res.status(400).json({ message: "Couldn't read that file. Save it as .xlsx or .csv and try again." });
  }
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  if (parsed.rows.length === 0) return res.status(400).json({ message: "The file has no learners in it." });
  if (parsed.rows.length > MAX_ROWS) return res.status(400).json({ message: `At most ${MAX_ROWS} learners per file.` });

  const cal = await getSchoolCalendar(schoolId);
  const [classes, existing] = await Promise.all([
    prisma.class.findMany({ where: { schoolId, isActive: true }, select: { id: true, name: true, stream: true, year: true } }),
    prisma.student.findMany({
      where: { schoolId, admissionNo: { in: parsed.rows.map((r) => r.values.admissionNo).filter(Boolean) } },
      select: { admissionNo: true },
    }),
  ]);
  // Class lookup by "Grade 7 E" / "Grade 7E", or Class + Stream columns.
  // The newest class with that name up to the current year wins. A bare
  // class name ("Grade 7") is only accepted when that year has one stream.
  const usable = classes.filter((c) => c.year <= cal.currentYear).sort((x, y) => x.year - y.year);
  const classByKey = new Map();
  const streamsByName = new Map(); // name key -> classes of its newest year
  for (const c of usable) {
    classByKey.set(key(`${c.name}${c.stream || ""}`), c);
    const nk = key(c.name);
    const prev = streamsByName.get(nk);
    if (!prev || prev[0].year < c.year) streamsByName.set(nk, [c]);
    else if (prev[0].year === c.year) prev.push(c);
  }
  for (const [nk, list] of streamsByName) if (list.length === 1) classByKey.set(`name:${nk}`, list[0]);
  const taken = new Set(existing.map((e) => e.admissionNo));
  const seen = new Set();

  const rows = parsed.rows.map(({ rowNumber, values: v }) => {
    const errors = [];
    const admissionNo = v.admissionNo;
    if (!admissionNo) errors.push("admission number is missing");
    else if (taken.has(admissionNo)) errors.push("admission number already exists in the school");
    else if (seen.has(admissionNo)) errors.push("admission number appears twice in the file");
    if (admissionNo) seen.add(admissionNo);
    if (!v.firstName) errors.push("first name is missing");
    if (!v.lastName) errors.push("last name is missing");
    const nameErr = checkNames(v);
    if (nameErr) errors.push(nameErr);

    const g = parseGender(v.gender);
    if (g.error) errors.push(g.error);
    const birth = parseDob(v.dob ? dayFirst(v.dob) : v.dob);
    if (birth.error) errors.push(birth.error);

    let klass = null;
    if (v.className) {
      klass = classByKey.get(key(`${v.className}${v.stream || ""}`)) || (!v.stream && classByKey.get(`name:${key(v.className)}`));
      if (!klass) errors.push(`class "${[v.className, v.stream].filter(Boolean).join(" ")}" not found`);
    }

    let guardian = null;
    if (v.guardianName || v.guardianPhone) {
      const phone = normalizePhone(v.guardianPhone);
      if (!phone) errors.push("parent phone is not a valid mobile number");
      const [first, ...rest] = String(v.guardianName || "").trim().split(/\s+/);
      if (!first) errors.push("parent name is missing");
      const rel = String(v.guardianRelationship || "GUARDIAN").trim().toUpperCase();
      const relationship = ["MOTHER", "FATHER", "GUARDIAN", "SPONSOR", "OTHER"].includes(rel) ? rel : "GUARDIAN";
      guardian = { firstName: first || "", lastName: rest.join(" ") || "-", phone, relationship };
    }

    return {
      row: rowNumber,
      admissionNo,
      name: `${v.firstName || ""} ${v.lastName || ""}`.trim(),
      className: klass ? `${klass.name}${klass.stream ? ` ${klass.stream}` : ""} (${klass.year})` : null,
      guardian: guardian ? { name: `${guardian.firstName} ${guardian.lastName}`.trim(), phone: guardian.phone } : null,
      errors,
      _data: { admissionNo, firstName: v.firstName, lastName: v.lastName, gender: g.value, dob: birth.value, classId: klass?.id || null, guardian },
    };
  });

  // Plan limit: the whole file must fit.
  const cap = effectiveCap(req.subscription, "students");
  if (cap != null) {
    const active = await prisma.student.count({ where: { schoolId, isActive: true } });
    if (active + rows.length > cap) {
      return res.status(409).json({
        message: `This file has ${rows.length} learners but the plan allows ${cap} active (${active} now). Upgrade or import fewer.`,
        code: "LIMIT_REACHED",
      });
    }
  }

  const invalid = rows.filter((r) => r.errors.length).length;
  const out = rows.map(({ _data, ...r }) => r);
  if (dryRun || invalid) {
    return res.status(dryRun ? 200 : 400).json({
      dryRun,
      valid: rows.length - invalid,
      invalid,
      rows: out,
      ...(dryRun ? {} : { message: `Nothing imported: ${invalid} row(s) have errors.` }),
    });
  }

  const created = await prisma.$transaction(
    async (tx) => {
      let n = 0;
      for (const r of rows) {
        const { guardian, ...d } = r._data;
        const student = await tx.student.create({ data: { schoolId, ...d, isActive: true } });
        n += 1;
        if (guardian) {
          const g =
            (await tx.guardian.findUnique({ where: { schoolId_phone: { schoolId, phone: guardian.phone } } })) ||
            (await tx.guardian.create({
              data: { schoolId, firstName: guardian.firstName, lastName: guardian.lastName, phone: guardian.phone },
            }));
          await tx.studentGuardian.create({
            data: { schoolId, studentId: student.id, guardianId: g.id, relationship: guardian.relationship, isPrimary: true },
          });
        }
      }
      return n;
    },
    { maxWait: 10_000, timeout: 120_000 }
  );

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId,
    action: "STUDENTS_IMPORTED",
    targetType: "SCHOOL",
    targetId: schoolId,
    metadata: { created, file: req.file.originalname },
  });
  return res.status(201).json({ dryRun: false, created, valid: rows.length, invalid: 0, rows: out });
});

export default router;
