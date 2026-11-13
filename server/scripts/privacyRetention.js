// scripts/privacyRetention.js
// Applies the data retention rules (Data Protection Act, 2019):
//   audit logs and attendance edit logs older than 7 years, sent SMS older
//   than 2 years, and learners who left more than 7 years ago.
// Override the years with RETENTION_AUDIT_YEARS, RETENTION_ATTENDANCE_EDIT_YEARS,
// RETENTION_SMS_YEARS and RETENTION_LEAVER_YEARS.
//
//   npm run privacy:retention                      report only (changes nothing)
//   npm run privacy:retention -- --write           delete old logs and messages
//   npm run privacy:retention -- --write --anonymise-leavers
//                                                  also anonymise old leavers
import { prisma } from "../src/lib/prisma.js";
import { applyRetention } from "../src/modules/privacy/privacy.js";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const anonymiseLeavers = args.has("--anonymise-leavers");

try {
  const r = await applyRetention({ write, anonymiseLeavers });
  const y = r.years;
  console.log(write ? "Retention applied:" : "Report only (add --write to apply):");
  console.log(`  audit log entries older than ${y.auditLogs} years: ${r.auditLogs}`);
  console.log(`  attendance edit entries older than ${y.attendanceEdits} years: ${r.attendanceEdits}`);
  console.log(`  SMS older than ${y.smsMessages} years: ${r.smsMessages}`);
  console.log(`  learners who left more than ${y.leavers} years ago, not yet anonymised: ${r.leaversDue}`);
  if (write && anonymiseLeavers) console.log(`  learners anonymised: ${r.leaversAnonymised}`);
  else if (r.leaversDue) console.log("  (add --write --anonymise-leavers to anonymise them)");
} catch (err) {
  console.error("Retention failed:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
