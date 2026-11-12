// src/routes/settings/export.routes.js
// A school's own data, for the school (audit M13 and the Data Protection Act
// right of access).
//
//   GET /api/settings/export               ADMIN  whole school as one .xlsx
//   GET /api/settings/export/student/:id   ADMIN  one learner as .json (a
//                                                  parent's data request)
//
// The workbook is streamed sheet by sheet and rows are read in batches, so a
// large school's full attendance history doesn't have to fit in memory.
import { Router } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveSchoolScope } from "../../utils/roleScope.js";
import { logAudit, actorCtx } from "../../utils/audit.js";
import { localDateString } from "../../utils/schoolTime.js";

const router = Router();
const BATCH = 5000;
const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const ts = (v) => (v ? new Date(v).toISOString() : "");

function scope(req, res) {
  const resolved = resolveSchoolScope(req, { allowPlatform: false, allowRoles: ["ADMIN", "SYSTEM_ADMIN"] });
  if (!resolved.ok) {
    res.status(resolved.code).json({ message: resolved.message });
    return null;
  }
  return resolved.schoolId;
}

/** Reads a table in id order, BATCH rows at a time. */
async function* batches(model, args) {
  let cursor = null;
  for (;;) {
    const rows = await model.findMany({
      ...args,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) return;
    yield rows;
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1].id;
  }
}

async function sheet(wb, name, columns, model, args, toRow) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width || 16 }));
  for await (const rows of batches(model, args)) {
    for (const r of rows) ws.addRow(toRow(r)).commit();
  }
  await ws.commit();
}

router.get("/", requireAuth, async (req, res) => {
  const schoolId = scope(req, res);
  if (!schoolId) return;

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, code: true } });
  const stamp = localDateString(new Date());
  const safe = String(school?.code || schoolId).replace(/[^A-Za-z0-9_-]/g, "");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="school-data-${safe}-${stamp}.xlsx"`);

  await logAudit({ req, ...actorCtx(req), schoolId, action: "SCHOOL_DATA_EXPORTED", targetType: "SCHOOL", targetId: schoolId });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false, useSharedStrings: false });
  const where = { schoolId };
  const cls = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})` : "");

  await sheet(
    wb,
    "Learners",
    [["Admission no", "adm"], ["First name", "first"], ["Last name", "last"], ["Gender", "gender", 10], ["Date of birth", "dob", 12], ["Class", "class", 22], ["Active", "active", 8], ["Left as", "exit", 12], ["Left on", "exitDate", 12], ["Note", "note", 30]],
    prisma.student,
    { where, include: { class: true } },
    (s) => ({ adm: s.admissionNo, first: s.firstName, last: s.lastName, gender: s.gender || "", dob: d(s.dob), class: cls(s.class), active: s.isActive ? "yes" : "no", exit: s.exitStatus || "", exitDate: d(s.exitDate), note: s.exitNote || "" })
  );
  await sheet(
    wb,
    "Guardians",
    [["Learner adm. no", "adm"], ["Learner", "learner", 24], ["Guardian", "name", 24], ["Relationship", "rel", 12], ["Phone", "phone"], ["Email", "email", 24], ["Primary", "primary", 8], ["Gets SMS", "sms", 8]],
    prisma.studentGuardian,
    { where, include: { guardian: true, student: { select: { admissionNo: true, firstName: true, lastName: true } } } },
    (l) => ({ adm: l.student.admissionNo, learner: `${l.student.firstName} ${l.student.lastName}`, name: `${l.guardian.firstName} ${l.guardian.lastName}`, rel: l.relationship, phone: l.guardian.phone, email: l.guardian.email || "", primary: l.isPrimary ? "yes" : "", sms: l.receivesSms ? "yes" : "no" })
  );
  await sheet(
    wb,
    "Classes",
    [["Class", "name", 14], ["Stream", "stream", 8], ["Year", "year", 8], ["Active", "active", 8]],
    prisma.class,
    { where },
    (c) => ({ name: c.name, stream: c.stream || "", year: c.year, active: c.isActive ? "yes" : "no" })
  );
  await sheet(
    wb,
    "Staff",
    [["Email", "email", 28], ["Role", "role", 10], ["Name", "name", 24], ["Phone", "phone"], ["Active", "active", 8], ["Last sign-in", "last", 20]],
    prisma.user,
    { where, select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true, teacher: { select: { firstName: true, lastName: true, phone: true } } } },
    (u) => ({ email: u.email, role: u.role, name: u.teacher ? `${u.teacher.firstName} ${u.teacher.lastName}` : "", phone: u.teacher?.phone || "", active: u.isActive ? "yes" : "no", last: ts(u.lastLoginAt) })
  );
  await sheet(
    wb,
    "Invoices",
    [["Invoice no", "no", 18], ["Learner adm. no", "adm"], ["Year", "year", 8], ["Term", "term", 8], ["Status", "status", 14], ["Total", "total", 10], ["Discount", "discount", 10], ["Paid", "paid", 10], ["Balance", "balance", 10], ["Created", "created", 20]],
    prisma.feeInvoice,
    { where, include: { student: { select: { admissionNo: true } } } },
    (i) => ({ no: i.invoiceNo || "", adm: i.student?.admissionNo || "", year: i.year, term: i.term, status: i.status, total: i.total, discount: i.discount, paid: i.paid, balance: i.balance, created: ts(i.createdAt) })
  );
  await sheet(
    wb,
    "Payments",
    [["Receipt no", "no", 20], ["Invoice no", "inv", 18], ["Learner adm. no", "adm"], ["Amount", "amount", 10], ["Method", "method", 10], ["Reference", "ref", 18], ["Received", "at", 20], ["Reversed", "rev", 8], ["Reversal reason", "why", 24]],
    prisma.feePayment,
    { where, include: { invoice: { select: { invoiceNo: true, student: { select: { admissionNo: true } } } } } },
    (p) => ({ no: p.receiptNo || "", inv: p.invoice?.invoiceNo || "", adm: p.invoice?.student?.admissionNo || "", amount: p.amount, method: p.method, ref: p.reference || "", at: ts(p.receivedAt), rev: p.isReversed ? "yes" : "", why: p.reversalReason || "" })
  );
  await sheet(
    wb,
    "Results",
    [["Exam", "exam", 24], ["Year", "year", 8], ["Term", "term", 8], ["Adm. no", "adm"], ["Learner", "name", 24], ["Total", "total", 8], ["Average", "avg", 8], ["Grade", "grade", 8], ["Position", "pos", 8]],
    prisma.studentResult,
    { where, include: { resultPublish: { select: { examSession: { select: { name: true, year: true, term: true } } } } } },
    (r) => ({ exam: r.resultPublish.examSession.name || "", year: r.resultPublish.examSession.year, term: r.resultPublish.examSession.term, adm: r.admissionNo || "", name: r.studentName || "", total: r.totalScore, avg: r.averageScore, grade: r.overallGrade || "", pos: r.position ?? "" })
  );
  await sheet(
    wb,
    "Marks",
    [["Exam", "exam", 24], ["Year", "year", 8], ["Term", "term", 8], ["Subject", "subject", 18], ["Adm. no", "adm"], ["Score", "score", 8], ["Comment", "comment", 24]],
    prisma.mark,
    { where, include: { student: { select: { admissionNo: true } }, markSheet: { select: { subject: { select: { name: true } }, examSession: { select: { name: true, year: true, term: true } } } } } },
    (m) => ({ exam: m.markSheet.examSession.name || "", year: m.markSheet.examSession.year, term: m.markSheet.examSession.term, subject: m.markSheet.subject?.name || "", adm: m.student.admissionNo, score: m.score ?? "", comment: m.comment || "" })
  );
  await sheet(
    wb,
    "Attendance",
    [["Date", "date", 12], ["Class", "class", 22], ["Adm. no", "adm"], ["Status", "status", 10], ["Minutes late", "late", 10], ["Comment", "comment", 24]],
    prisma.attendanceRecord,
    { where, include: { student: { select: { admissionNo: true } }, session: { select: { date: true, class: true } } } },
    (a) => ({ date: d(a.session.date), class: cls(a.session.class), adm: a.student.admissionNo, status: a.status, late: a.minutesLate ?? "", comment: a.comment || "" })
  );

  await wb.commit();
});

router.get("/student/:id", requireAuth, async (req, res) => {
  const schoolId = scope(req, res);
  if (!schoolId) return;
  const student = await prisma.student.findFirst({
    where: { id: String(req.params.id), schoolId },
    include: {
      class: { select: { name: true, stream: true, year: true } },
      guardianLinks: { include: { guardian: { select: { firstName: true, lastName: true, phone: true, email: true } } } },
      feeInvoices: { include: { lines: true, payments: true } },
      attendanceRecords: { include: { session: { select: { date: true } } } },
      marks: { include: { markSheet: { select: { subject: { select: { name: true } }, examSession: { select: { name: true, year: true, term: true } } } } } },
    },
  });
  if (!student) return res.status(404).json({ message: "Student not found" });
  const results = await prisma.studentResult.findMany({
    where: { schoolId, studentId: student.id },
    include: { subjectResults: true, resultPublish: { select: { examSession: { select: { name: true, year: true, term: true } } } } },
  });

  await logAudit({ req, ...actorCtx(req), schoolId, action: "STUDENT_DATA_EXPORTED", targetType: "STUDENT", targetId: student.id });
  res.setHeader("Content-Disposition", `attachment; filename="learner-${String(student.admissionNo).replace(/[^A-Za-z0-9_-]/g, "")}.json"`);
  return res.json({ exportedAt: new Date().toISOString(), student, publishedResults: results });
});

export default router;
