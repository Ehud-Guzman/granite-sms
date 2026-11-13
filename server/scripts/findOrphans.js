// Lists rows that point at a student or class that doesn't exist.
// The 20261111120000_add_missing_foreign_keys migration refuses to run while
// any exist. Read-only.
//
//   node scripts/findOrphans.js
import dotenv from "dotenv";
dotenv.config();

const { prisma } = await import("../src/lib/prisma.js");

const checks = [
  {
    label: "Invoices whose student doesn't exist",
    sql: `SELECT i.id, i."schoolId", i."invoiceNo" AS ref, i."studentId" AS missing FROM "FeeInvoice" i
          WHERE NOT EXISTS (SELECT 1 FROM "Student" s WHERE s.id = i."studentId")`,
  },
  {
    label: "Invoices whose class doesn't exist",
    sql: `SELECT i.id, i."schoolId", i."invoiceNo" AS ref, i."classId" AS missing FROM "FeeInvoice" i
          WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = i."classId")`,
  },
  {
    label: "Fee plans whose class doesn't exist",
    sql: `SELECT p.id, p."schoolId", p.title AS ref, p."classId" AS missing FROM "FeePlan" p
          WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = p."classId")`,
  },
  {
    label: "Attendance registers whose class doesn't exist",
    sql: `SELECT a.id, a."schoolId", a.date::text AS ref, a."classId" AS missing FROM "AttendanceSession" a
          WHERE NOT EXISTS (SELECT 1 FROM "Class" c WHERE c.id = a."classId")`,
  },
  {
    label: "Attendance records whose student doesn't exist",
    sql: `SELECT r.id, r."schoolId", r."sessionId" AS ref, r."studentId" AS missing FROM "AttendanceRecord" r
          WHERE NOT EXISTS (SELECT 1 FROM "Student" s WHERE s.id = r."studentId")`,
  },
];

let total = 0;
for (const c of checks) {
  const rows = await prisma.$queryRawUnsafe(c.sql);
  total += rows.length;
  console.log(`${c.label}: ${rows.length}`);
  for (const r of rows.slice(0, 20)) console.log(`   school=${r.schoolId} row=${r.id} ref=${r.ref ?? ""} missing=${r.missing}`);
  if (rows.length > 20) console.log(`   … and ${rows.length - 20} more`);
}
console.log(total ? `\n${total} orphaned row(s). Resolve them before running migrations.` : "\nNo orphaned rows.");
await prisma.$disconnect();
process.exit(total ? 1 : 0);
