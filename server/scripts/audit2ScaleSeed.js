// Audit 2 (docs/AUDIT_PLAN.md 2.3): grows the demo into large-school test data.
//
// Run after `seed:demo` on a throwaway database whose name contains "audit":
//
//   DATABASE_URL=postgresql://.../granite_audit2_large node scripts/audit2ScaleSeed.js --factor=7 --history=2 --schools=200
//
//   --factor=N   Mwangaza ends up with N times its learners (7 ≈ 1,500, 19 ≈ 4,000).
//                Each copy brings its own invoices, payments, attendance marks,
//                exam marks and frozen results, in the same classes and exams.
//   --history=N  adds N earlier years of fee history (invoices and payments) for every learner.
//   --schools=N  adds N small schools (admin, 3 classes, 15 learners each) for the platform view.
//
// Refuses any database without "audit" in its name: it only ever adds test data.
import crypto from "crypto";
import pkg from "@prisma/client";

const { PrismaClient } = pkg;
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};
const FACTOR = arg("factor", 7);
const HISTORY = arg("history", 2);
const SCHOOLS = arg("schools", 200);

const dbName = (/^postgres(?:ql)?:\/\/[^/]+\/([^/?#]*)/i.exec(process.env.DATABASE_URL || "") || [])[1] || "";
if (!/audit/i.test(dbName)) {
  console.error(`Refusing: database "${dbName}" does not have "audit" in its name.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const newId = () => "c" + crypto.randomBytes(12).toString("hex");
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const shift = (d, years) => (d ? new Date(new Date(d).getTime() - years * YEAR_MS) : d);

async function insert(model, rows) {
  for (let i = 0; i < rows.length; i += 2000) await prisma[model].createMany({ data: rows.slice(i, i + 2000) });
  return rows.length;
}

async function main() {
  const t0 = Date.now();
  const school = await prisma.school.findFirst({ where: { name: { contains: "Mwangaza" } } });
  if (!school) throw new Error("Run seed:demo first.");
  const S = school.id;
  const counts = {};
  const add = (k, n) => (counts[k] = (counts[k] || 0) + n);

  // Lift the plan limits so the extra learners are allowed.
  await prisma.subscription.updateMany({ where: { schoolId: S }, data: { maxStudents: null, maxTeachers: null, maxClasses: null, limits: { USERS_MAX: null, CLASSES_MAX: null, STUDENTS_MAX: null, TEACHERS_MAX: null } } });

  const students = await prisma.student.findMany({ where: { schoolId: S } });
  const ids = students.map((s) => s.id);
  const invoices = await prisma.feeInvoice.findMany({ where: { schoolId: S, studentId: { in: ids } }, include: { lines: true } });
  const payments = await prisma.feePayment.findMany({ where: { schoolId: S, studentId: { in: ids } } });
  const allocs = await prisma.feePaymentAllocation.findMany({ where: { schoolId: S } });
  const records = await prisma.attendanceRecord.findMany({ where: { schoolId: S, studentId: { in: ids } } });
  const marks = await prisma.mark.findMany({ where: { schoolId: S, studentId: { in: ids } } });
  const sResults = await prisma.studentResult.findMany({ where: { schoolId: S }, include: { subjects: true } }).catch(() => []);

  const by = (rows, key) => rows.reduce((m, r) => (m.get(r[key]) ? m.get(r[key]).push(r) : m.set(r[key], [r]), m), new Map());
  const invByStudent = by(invoices, "studentId");
  const payByStudent = by(payments, "studentId");
  const allocByPayment = by(allocs, "paymentId");
  const recByStudent = by(records, "studentId");
  const markByStudent = by(marks, "studentId");
  const resByStudent = by(sResults, "studentId");

  // ---- 1. Copies of every learner, with their records ----
  for (let k = 1; k < FACTOR; k++) {
    const out = { student: [], feeInvoice: [], feeInvoiceLine: [], feePayment: [], feePaymentAllocation: [], attendanceRecord: [], mark: [], studentResult: [], subjectResult: [] };
    for (const s of students) {
      const sid = newId();
      out.student.push({ ...s, id: sid, admissionNo: `${s.admissionNo}-${k}`, userId: null });
      const invMap = new Map();
      for (const inv of invByStudent.get(s.id) || []) {
        const { lines, ...row } = inv;
        const iid = newId();
        invMap.set(inv.id, iid);
        out.feeInvoice.push({ ...row, id: iid, studentId: sid, invoiceNo: `${inv.invoiceNo}-${k}` });
        for (const l of lines) out.feeInvoiceLine.push({ ...l, id: newId(), invoiceId: iid });
      }
      for (const p of payByStudent.get(s.id) || []) {
        const pid = newId();
        out.feePayment.push({ ...p, id: pid, studentId: sid, invoiceId: p.invoiceId ? invMap.get(p.invoiceId) || null : null, receiptNo: `${p.receiptNo}-${k}`, clientTxnId: null });
        for (const a of allocByPayment.get(p.id) || []) out.feePaymentAllocation.push({ ...a, id: newId(), paymentId: pid, invoiceId: invMap.get(a.invoiceId) });
      }
      for (const r of recByStudent.get(s.id) || []) out.attendanceRecord.push({ ...r, id: newId(), studentId: sid });
      for (const m of markByStudent.get(s.id) || []) out.mark.push({ ...m, id: newId(), studentId: sid });
      for (const res of resByStudent.get(s.id) || []) {
        const { subjects, ...row } = res;
        const rid = newId();
        out.studentResult.push({ ...row, id: rid, studentId: sid });
        for (const sub of subjects) out.subjectResult.push({ ...sub, id: newId(), studentResultId: rid });
      }
    }
    for (const [model, rows] of Object.entries(out)) add(model, await insert(model, rows));
    console.log(`  copy ${k}/${FACTOR - 1} done`);
  }

  // ---- 2. Earlier years of fee history for every learner ----
  if (HISTORY > 0) {
    const allInv = await prisma.feeInvoice.findMany({ where: { schoolId: S }, include: { lines: true } });
    const allPay = await prisma.feePayment.findMany({ where: { schoolId: S } });
    const allAlloc = await prisma.feePaymentAllocation.findMany({ where: { schoolId: S } });
    const payByInv = by(allPay.filter((p) => p.invoiceId), "invoiceId");
    const allocByPay = by(allAlloc, "paymentId");
    for (let y = 1; y <= HISTORY; y++) {
      const out = { feeInvoice: [], feeInvoiceLine: [], feePayment: [], feePaymentAllocation: [] };
      for (const inv of allInv) {
        const { lines, ...row } = inv;
        const iid = newId();
        // Past years are settled: paid in full.
        out.feeInvoice.push({ ...row, id: iid, year: inv.year - y, invoiceNo: `${inv.invoiceNo}-Y${y}`, paid: inv.total - (inv.discount || 0), balance: 0, status: "PAID", voidedAt: null, voidedBy: null, voidReason: null, createdAt: shift(inv.createdAt, y), updatedAt: shift(inv.updatedAt, y) });
        for (const l of lines) out.feeInvoiceLine.push({ ...l, id: newId(), invoiceId: iid });
        const due = inv.total - (inv.discount || 0);
        const pays = payByInv.get(inv.id) || [];
        const pid = newId();
        const first = pays[0];
        out.feePayment.push({
          ...(first || {}), id: pid, schoolId: S, studentId: inv.studentId, invoiceId: iid, amount: due, method: first?.method || "MPESA",
          reference: first?.reference ? `${first.reference}-Y${y}` : null, receiptNo: `RCPT-Y${y}-${iid.slice(-10)}`, clientTxnId: null,
          isReversed: false, reversedAt: null, reversedBy: null, reversalReason: null,
          receivedAt: shift(first?.receivedAt || inv.createdAt, y), createdAt: shift(first?.createdAt || inv.createdAt, y),
          receivedBy: first?.receivedBy || inv.discountedBy || null,
        });
        if (due > 0) out.feePaymentAllocation.push({ id: newId(), schoolId: S, paymentId: pid, invoiceId: iid, amount: due, createdAt: shift(inv.createdAt, y) });
        void allocByPay;
      }
      for (const [model, rows] of Object.entries(out)) add(`${model} (history)`, await insert(model, rows));
      console.log(`  history year -${y} done`);
    }
  }

  // ---- 3. Many small schools for the platform admin's screens ----
  if (SCHOOLS > 0) {
    const out = { school: [], schoolSettings: [], subscription: [], user: [], class: [], student: [] };
    const pw = (await prisma.user.findFirst({ where: { schoolId: S, role: "ADMIN" } })).password;
    for (let i = 1; i <= SCHOOLS; i++) {
      const id = `scale${String(i).padStart(4, "0")}${crypto.randomBytes(3).toString("hex")}`;
      out.school.push({ id, name: `Scale Test School ${i}`, code: id, isActive: i % 17 !== 0 });
      out.schoolSettings.push({ id: newId(), schoolId: id, currentAcademicYear: String(new Date().getUTCFullYear()) });
      out.subscription.push({ id: newId(), schoolId: id, planCode: ["FREE", "BASIC", "PRO"][i % 3], status: i % 3 === 0 ? "TRIAL" : "ACTIVE", maxStudents: 300, maxTeachers: 30, maxClasses: 15 });
      out.user.push({ id: newId(), email: `admin@scale-${i}.invalid`, password: pw, role: "ADMIN", schoolId: id, isActive: true, mustChangePassword: false });
      for (let g = 1; g <= 3; g++) {
        const cid = newId();
        out.class.push({ id: cid, schoolId: id, name: `Grade ${g + 3}`, stream: null, year: new Date().getUTCFullYear(), isActive: true });
        for (let n = 1; n <= 5; n++) out.student.push({ id: newId(), schoolId: id, admissionNo: `S${i}-${g}${n}`, firstName: "Test", lastName: `Learner${g}${n}`, classId: cid, isActive: true });
      }
    }
    for (const [model, rows] of Object.entries(out)) add(`${model} (schools)`, await insert(model, rows));
  }

  console.log(counts);
  console.log(`Mwangaza now has ${await prisma.student.count({ where: { schoolId: S } })} learners and ${await prisma.feeInvoice.count({ where: { schoolId: S } })} invoices. ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error("Scale seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
