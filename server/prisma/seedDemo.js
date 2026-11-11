// prisma/seedDemo.js
//
// Builds the portfolio demo: Mwangaza Academy, an invented school with about
// 200 students, its teachers, a year of fees, recent attendance and exams.
// Every date is counted from the day it runs, so a refresh keeps it current.
//
//   npm run seed:demo                              dry run: says where it would write
//   npm run seed:demo -- --confirm-write --reset   empties the demo database and rebuilds it
//
// Safety: it refuses any database whose name does not contain "demo"
// (DATABASE_URL), because --reset empties every table. All people, schools,
// emails and numbers are invented; emails use the reserved ".invalid" domain.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { DEMO_ACCOUNTS, dbNameOf, isDemoDatabase } from "../src/config/demo.js";

dotenv.config();

const args = new Set(process.argv.slice(2));
const DB_URL = process.env.DATABASE_URL || "";

function hostOf(url) {
  const m = /@([^/:?]+)/.exec(String(url));
  return m ? m[1] : "?";
}

if (!isDemoDatabase(DB_URL)) {
  console.error(
    `Refusing: the database "${dbNameOf(DB_URL) || "?"}" does not have "demo" in its name. ` +
      `The demo seed only ever writes to a demo database.`
  );
  process.exit(1);
}

if (!args.has("--confirm-write")) {
  console.log(`Dry run. Would build the demo in "${dbNameOf(DB_URL)}" on ${hostOf(DB_URL)}.`);
  console.log("Run again with --confirm-write --reset to do it.");
  process.exit(0);
}

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Random but repeatable: the same names every refresh, fresh dates.  */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function gauss(mean, sd) {
  let u = 0;
  let v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const newId = () => "c" + crypto.randomBytes(12).toString("hex");
const HEX = "0123456789ABCDEF";
const randHex = (n) => Array.from({ length: n }, () => HEX[randInt(0, 15)]).join("");
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const randCode = (n) => Array.from({ length: n }, () => ALNUM[randInt(0, ALNUM.length - 1)]).join("");

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
const YEAR = TODAY.getUTCFullYear();

// Kenyan school year, roughly: three terms.
const TERM_STARTS = {
  TERM1: new Date(Date.UTC(YEAR, 0, 5)),
  TERM2: new Date(Date.UTC(YEAR, 3, 27)),
  TERM3: new Date(Date.UTC(YEAR, 7, 24)),
};
const TERM_LABEL = { TERM1: "Term 1", TERM2: "Term 2", TERM3: "Term 3" };

const CURRENT_TERM =
  TODAY >= TERM_STARTS.TERM3 ? "TERM3" : TODAY >= TERM_STARTS.TERM2 ? "TERM2" : "TERM1";
const TERMS_THIS_YEAR = ["TERM1", "TERM2", "TERM3"].slice(
  0,
  ["TERM1", "TERM2", "TERM3"].indexOf(CURRENT_TERM) + 1
);

function termStart(term) {
  const s = TERM_STARTS[term];
  // In the first days of January the term has not "started" yet; pretend it
  // started two weeks ago so there is still something to show.
  if (term === CURRENT_TERM && s > new Date(TODAY.getTime() - 14 * DAY)) {
    return new Date(TODAY.getTime() - 14 * DAY);
  }
  return s;
}
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
// A time of day in Nairobi (UTC+3), returned as a UTC Date.
const atNairobi = (d, h, m = 0) => new Date(d.getTime() + (h - 3) * 60 * 60 * 1000 + m * 60 * 1000);
const isWeekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
const weeksInto = (term) => Math.floor((TODAY - termStart(term)) / (7 * DAY));
// A random moment between two dates, during office hours, never after now.
function randomMomentBetween(from, to) {
  const span = Math.max(0, Math.floor((to - from) / DAY));
  let d = addDays(from, randInt(0, span));
  if (!isWeekday(d)) d = addDays(d, d.getUTCDay() === 6 ? 2 : 1);
  if (d > TODAY) d = TODAY;
  const t = atNairobi(d, randInt(8, 16), randInt(0, 59));
  return t > NOW ? new Date(NOW.getTime() - randInt(5, 120) * 60 * 1000) : t;
}

/* ------------------------------------------------------------------ */
/* Names (invented combinations)                                       */
/* ------------------------------------------------------------------ */
const GIRLS = [
  "Faith", "Mercy", "Joy", "Grace", "Esther", "Ruth", "Sharon", "Diana", "Purity", "Ivy",
  "Sheila", "Brenda", "Cynthia", "Lilian", "Winnie", "Tracy", "Michelle", "Valentine",
  "Stacy", "Natalie", "Precious", "Abigail", "Hope", "Imani", "Neema", "Makena", "Kendi",
  "Wanjiru", "Njeri", "Akinyi", "Chebet", "Nafula", "Wairimu", "Atieno", "Mumbua", "Moraa",
];
const BOYS = [
  "Brian", "Kevin", "Dennis", "Collins", "Victor", "Ian", "Felix", "Allan", "Eric", "Stephen",
  "Emmanuel", "Elvis", "Ryan", "Joel", "Mark", "Moses", "Caleb", "Gideon", "Timothy", "Hassan",
  "Baraka", "Jabari", "Kamau", "Kiprop", "Mwangi", "Juma", "Tumaini", "Wekesa", "Amos", "Ethan",
  "Nathan", "Samuel", "Daniel", "Abdi", "Omari", "Kelvin",
];
const SURNAMES = [
  "Kamau", "Mwangi", "Otieno", "Odhiambo", "Kiprop", "Chebet", "Wanjala", "Wekesa", "Mutua",
  "Musyoka", "Njoroge", "Kariuki", "Omondi", "Ochieng", "Kiptoo", "Rotich", "Barasa", "Simiyu",
  "Nyaga", "Muriuki", "Ndung'u", "Gitau", "Macharia", "Waweru", "Onyango", "Owino", "Langat",
  "Korir", "Kimani", "Maina", "Githinji", "Mburu", "Ouma", "Abdi", "Hassan", "Mohamed", "Nduta",
  "Wafula", "Cheruiyot", "Kilonzo", "Mwende", "Nyamweya",
];

/* ------------------------------------------------------------------ */
/* Collected rows, inserted in bulk at the end                        */
/* ------------------------------------------------------------------ */
const rows = {
  school: [], schoolSettings: [], subscription: [], user: [], teacher: [], class: [], student: [],
  subject: [], classTeacher: [], teachingAssignment: [], feeItem: [], feePlan: [], feePlanItem: [],
  feeInvoice: [], feeInvoiceLine: [], feePayment: [], attendanceSession: [], attendanceRecord: [],
  attendanceEditLog: [], examType: [], examSession: [], markSheet: [], mark: [], examAuditLog: [],
  auditLog: [],
};

const ALL_ENTITLEMENTS = {
  FEES_READ: true, FEES_WRITE: true, ATTENDANCE_READ: true, ATTENDANCE_WRITE: true,
  EXAMS_READ: true, EXAMS_WRITE: true,
};
const START_OF_YEAR = new Date(Date.UTC(YEAR, 0, 2, 6));

function addSchool({ code, name, shortName, contactEmail, plan, status, maxStudents, maxTeachers, maxClasses, maxUsers, trialDays }) {
  const school = {
    id: newId(), code, name, shortName, contactEmail, contactPhone: null, isActive: true,
    onboardingCompleted: true, createdAt: START_OF_YEAR,
  };
  rows.school.push(school);
  rows.subscription.push({
    id: newId(), schoolId: school.id, status, planCode: plan,
    maxStudents, maxTeachers, maxClasses,
    limits: { STUDENTS_MAX: maxStudents, TEACHERS_MAX: maxTeachers, CLASSES_MAX: maxClasses, USERS_MAX: maxUsers },
    entitlements: ALL_ENTITLEMENTS,
    startsAt: START_OF_YEAR,
    currentPeriodEnd: trialDays ? null : addDays(TODAY, 365),
    trialEndsAt: trialDays ? addDays(TODAY, trialDays) : null,
    createdAt: START_OF_YEAR,
  });
  return school;
}

function addSettings(schoolId, extra = {}) {
  rows.schoolSettings.push({
    id: newId(), schoolId, enableClassTeachers: true, enableSubjectAssignments: true,
    currentAcademicYear: String(YEAR), term1Label: "Term 1", term2Label: "Term 2", term3Label: "Term 3",
    ...extra,
  });
}

let PASSWORD_HASH = "";
function addUser({ email, role, schoolId = null, lastLoginAt = null }) {
  const user = {
    id: newId(), email, password: PASSWORD_HASH, role, schoolId, isActive: true,
    mustChangePassword: false, failedLoginAttempts: 0, lastLoginAt, createdAt: START_OF_YEAR,
  };
  rows.user.push(user);
  return user;
}

function uniqueNamePicker() {
  const used = new Set();
  return function next(gender) {
    for (let i = 0; i < 200; i++) {
      const first = pick(gender === "F" ? GIRLS : BOYS);
      const last = pick(SURNAMES);
      const key = `${first} ${last}`;
      if (!used.has(key)) {
        used.add(key);
        return { firstName: first, lastName: last };
      }
    }
    throw new Error("Ran out of names");
  };
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */
function build() {
  /* ---------- Platform ---------- */
  const sysadmin = addUser({ email: DEMO_ACCOUNTS.SYSTEM_ADMIN, role: "SYSTEM_ADMIN", lastLoginAt: addDays(NOW, -1) });

  /* ---------- Mwangaza Academy ---------- */
  const mwa = addSchool({
    code: "MWA", name: "Mwangaza Academy", shortName: "Mwangaza", contactEmail: "office@mwangaza.invalid",
    plan: "PRO", status: "ACTIVE", maxStudents: 1200, maxTeachers: 80, maxClasses: 40, maxUsers: 60,
  });
  addSettings(mwa.id, {
    brandPrimaryColor: "#0f766e",
    brandSecondaryColor: "#f59e0b",
    printHeaderText: "Mwangaza Academy · Learning to shine",
    printFooterText: "Sample data for a portfolio demo. Not a real school.",
  });
  const S = mwa.id;

  const admin = addUser({ email: DEMO_ACCOUNTS.ADMIN, role: "ADMIN", schoolId: S, lastLoginAt: atNairobi(TODAY, 7, 42) });
  const bursar = addUser({ email: DEMO_ACCOUNTS.BURSAR, role: "BURSAR", schoolId: S, lastLoginAt: atNairobi(TODAY, 7, 55) });
  const BURSAR_NAME = "Rose Nduta (Bursar)";

  // Teachers: name, subjects they can teach. Grace is the demo teacher.
  const TEACHERS = [
    ["Grace", "Wanjiru", ["MAT", "SCI"], DEMO_ACCOUNTS.TEACHER],
    ["Peter", "Kamau", ["MAT", "PTS"]],
    ["Lucy", "Achieng", ["ENG", "CRE"]],
    ["Daniel", "Mutua", ["KIS", "SST"]],
    ["Faith", "Chebet", ["SCI", "AGR"]],
    ["Samuel", "Otieno", ["ENG", "SST"]],
    ["Mercy", "Njoki", ["KIS", "CRE"]],
    ["John", "Kiprono", ["MAT", "SCI"]],
    ["Esther", "Wambui", ["ENG", "KIS"]],
    ["Joseph", "Barasa", ["SST", "AGR"]],
    ["Ann", "Mwende", ["CA", "CRE"]],
    ["Brian", "Odhiambo", ["PTS", "MAT"]],
  ];
  const teachers = TEACHERS.map(([firstName, lastName, subjects, email]) => {
    const user = addUser({
      email: email || `${firstName}.${lastName}@mwangaza.invalid`.toLowerCase(),
      role: "TEACHER",
      schoolId: S,
      lastLoginAt: atNairobi(addDays(TODAY, -randInt(0, 3)), 7, randInt(10, 50)),
    });
    const t = { id: newId(), schoolId: S, userId: user.id, firstName, lastName, phone: null, createdAt: START_OF_YEAR };
    rows.teacher.push(t);
    return { ...t, user, subjects, load: 0 };
  });
  const grace = teachers[0];

  // Subjects
  const SUBJECTS = [
    ["MAT", "Mathematics"], ["ENG", "English"], ["KIS", "Kiswahili"], ["SCI", "Integrated Science"],
    ["SST", "Social Studies"], ["CRE", "Christian Religious Education"], ["AGR", "Agriculture"],
    ["CA", "Creative Arts"], ["PTS", "Pre-Technical Studies"],
  ];
  const subjectByCode = {};
  for (const [code, name] of SUBJECTS) {
    const s = { id: newId(), schoolId: S, code, name, isActive: true, createdAt: START_OF_YEAR };
    rows.subject.push(s);
    subjectByCode[code] = s;
  }
  const PRIMARY_SUBJECTS = ["MAT", "ENG", "KIS", "SCI", "SST", "CRE", "CA"];
  const JUNIOR_SUBJECTS = ["MAT", "ENG", "KIS", "SCI", "SST", "AGR", "PTS"];

  // Classes, with their class teacher (index into TEACHERS)
  const CLASSES = [
    ["Grade 4", null, 4, 8], ["Grade 5", null, 5, 6], ["Grade 6", null, 6, 2],
    ["Grade 7", "East", 7, 0], ["Grade 7", "West", 7, 1],
    ["Grade 8", "East", 8, 3], ["Grade 8", "West", 8, 4], ["Grade 9", null, 9, 5],
  ];
  const classes = CLASSES.map(([name, stream, grade, ctIdx]) => {
    const c = { id: newId(), schoolId: S, name, stream, year: YEAR, isActive: true, createdAt: START_OF_YEAR };
    rows.class.push(c);
    rows.classTeacher.push({ id: newId(), schoolId: S, classId: c.id, teacherId: teachers[ctIdx].id, isActive: true });
    return {
      ...c, grade, classTeacher: teachers[ctIdx],
      subjects: grade <= 6 ? PRIMARY_SUBJECTS : JUNIOR_SUBJECTS,
      label: stream ? `${name} ${stream}` : name, students: [], teacherFor: {},
    };
  });
  const byLabel = Object.fromEntries(classes.map((c) => [c.label, c]));

  // Teaching assignments. Grace's are fixed so the demo teacher has a clear load.
  const fixed = [
    ["Grade 7 East", "MAT"], ["Grade 7 West", "MAT"], ["Grade 8 East", "MAT"], ["Grade 7 East", "SCI"],
  ];
  for (const [label, code] of fixed) {
    byLabel[label].teacherFor[code] = grace;
    grace.load += 1;
  }
  for (const c of classes) {
    for (const code of c.subjects) {
      if (c.teacherFor[code]) continue;
      const options = teachers.filter((t) => t !== grace && t.subjects.includes(code));
      options.sort((a, b) => a.load - b.load);
      const t = options[0];
      c.teacherFor[code] = t;
      t.load += 1;
    }
    for (const code of c.subjects) {
      rows.teachingAssignment.push({
        id: newId(), schoolId: S, teacherId: c.teacherFor[code].id, classId: c.id,
        subjectId: subjectByCode[code].id, isActive: true, createdAt: START_OF_YEAR,
      });
    }
  }

  // Students
  const nextName = uniqueNamePicker();
  let admSeq = 1001;
  const allStudents = [];
  let demoStudent = null;
  for (const c of classes) {
    const count = randInt(22, 28);
    for (let i = 0; i < count; i++) {
      const isDemo = c.label === "Grade 7 East" && i === 0;
      const gender = isDemo ? "F" : chance(0.5) ? "F" : "M";
      const name = isDemo ? { firstName: "Zawadi", lastName: "Kiptoo" } : nextName(gender);
      const age = c.grade + 5;
      const st = {
        id: newId(), schoolId: S, admissionNo: `MWA-${admSeq++}`, ...name, gender,
        dob: new Date(Date.UTC(YEAR - age, randInt(0, 11), randInt(1, 28))),
        classId: c.id, isActive: true, userId: null, createdAt: START_OF_YEAR,
      };
      const meta = {
        row: st, cls: c,
        ability: isDemo ? 71 : clamp(gauss(58, 13), 28, 93),
        absenceRate: 0.03,
        transport: chance(0.3),
        bursary: !isDemo && chance(0.08) ? pick([2000, 3000, 5000]) : 0,
      };
      if (isDemo) demoStudent = meta;
      c.students.push(meta);
      allStudents.push(meta);
      rows.student.push(st);
    }
  }
  // A few students who miss school a lot (they show up in the defaulters report).
  for (const m of allStudents.filter((s) => s !== demoStudent && chance(0.03)).slice(0, 6)) m.absenceRate = 0.22;
  // Two students who have left the school (inactive).
  for (const label of ["Grade 6", "Grade 8 West"]) {
    const c = byLabel[label];
    const gender = chance(0.5) ? "F" : "M";
    rows.student.push({
      id: newId(), schoolId: S, admissionNo: `MWA-${admSeq++}`, ...nextName(gender), gender,
      dob: new Date(Date.UTC(YEAR - c.grade - 5, randInt(0, 11), randInt(1, 28))),
      classId: c.id, isActive: false, userId: null, createdAt: START_OF_YEAR,
    });
  }
  // The demo student can sign in.
  const studentUser = addUser({ email: DEMO_ACCOUNTS.STUDENT, role: "STUDENT", schoolId: S, lastLoginAt: addDays(NOW, -2) });
  demoStudent.row.userId = studentUser.id;

  /* ---------- Fees ---------- */
  const FEE_ITEMS = ["Tuition", "Lunch Programme", "Activity Fee", "Exam Fee", "Development Levy", "Transport"];
  const feeItem = {};
  for (const name of FEE_ITEMS) {
    const f = { id: newId(), schoolId: S, name, code: null, isActive: true, createdAt: START_OF_YEAR };
    rows.feeItem.push(f);
    feeItem[name] = f;
  }
  const AMOUNTS = {
    primary: { Tuition: 9500, "Lunch Programme": 4200, "Activity Fee": 1000, "Exam Fee": 800, "Development Levy": 1500, Transport: 3500 },
    junior: { Tuition: 12500, "Lunch Programme": 4800, "Activity Fee": 1200, "Exam Fee": 1000, "Development Levy": 2000, Transport: 3500 },
  };
  const usedInvoiceNos = new Set();
  const usedReceiptNos = new Set();
  const invoiceNo = () => {
    let n;
    do n = `INV-${YEAR}-${randHex(6)}`; while (usedInvoiceNos.has(n));
    usedInvoiceNos.add(n);
    return n;
  };
  const receiptNo = (d) => {
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    let n;
    do n = `RCPT-${ymd}-${randHex(8)}`; while (usedReceiptNos.has(n));
    usedReceiptNos.add(n);
    return n;
  };
  const roundTo = (x, step) => Math.max(step, Math.round(x / step) * step);

  function addPayment(invoice, amount, at, extra = {}) {
    const r = rand();
    const method = r < 0.62 ? "MPESA" : r < 0.87 ? "BANK" : "CASH";
    const reference = method === "MPESA" ? randCode(10) : method === "BANK" ? `EQB-${randInt(100000, 999999)}` : null;
    const p = {
      id: newId(), schoolId: S, invoiceId: invoice.id, clientTxnId: null, amount, method, reference,
      receivedAt: at, receivedBy: BURSAR_NAME, receiptNo: receiptNo(at), receiptIssuedAt: at, createdAt: at,
      isReversed: false, ...extra,
    };
    rows.feePayment.push(p);
    if (!p.isReversed) {
      rows.auditLog.push({
        id: newId(), actorId: bursar.id, actorRole: "BURSAR", actorEmail: bursar.email, schoolId: S,
        action: "FEES_PAYMENT_POSTED", targetType: "FEE_PAYMENT", targetId: p.id,
        metadata: { amount, method, receiptNo: p.receiptNo }, ip: "198.51.100.24", userAgent: "Demo", createdAt: at,
      });
    }
    return p;
  }

  const currentInvoices = [];
  for (const term of TERMS_THIS_YEAR) {
    const start = termStart(term);
    const isCurrent = term === CURRENT_TERM;
    const termEnd = isCurrent ? TODAY : addDays(start, 13 * 7);

    for (const c of classes) {
      const amounts = c.grade <= 6 ? AMOUNTS.primary : AMOUNTS.junior;
      const plan = {
        id: newId(), schoolId: S, classId: c.id, year: YEAR, term,
        title: `${c.label} ${TERM_LABEL[term]} ${YEAR} fees`, isActive: true, createdAt: addDays(start, -14),
      };
      rows.feePlan.push(plan);
      for (const name of FEE_ITEMS) {
        rows.feePlanItem.push({
          id: newId(), feePlanId: plan.id, feeItemId: feeItem[name].id, amount: amounts[name], required: name !== "Transport",
        });
      }

      for (const m of c.students) {
        const items = FEE_ITEMS.filter((n) => n !== "Transport" || m.transport);
        const total = items.reduce((s, n) => s + amounts[n], 0);
        const discount = m.bursary;
        const payable = total - discount;

        // How much of this term has been paid.
        let paid;
        if (!isCurrent) {
          paid = chance(0.93) ? payable : roundTo(payable * (0.6 + rand() * 0.3), 100);
        } else if (m === demoStudent) {
          paid = roundTo(payable * 0.65, 100);
        } else {
          const r = rand();
          paid = r < 0.42 ? payable : r < 0.8 ? roundTo(payable * (0.3 + rand() * 0.55), 100) : r < 0.92 ? 0 : roundTo(payable * 0.15, 100);
        }
        paid = Math.min(paid, payable);
        const balance = payable - paid;
        const invoice = {
          id: newId(), schoolId: S, studentId: m.row.id, classId: c.id, year: YEAR, term,
          invoiceNo: invoiceNo(), status: paid >= payable ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED",
          total, paid, balance, discount,
          discountReason: discount ? pick(["Bursary (sponsor)", "Sibling discount", "Staff child"]) : null,
          discountedBy: discount ? "School Admin" : null,
          discountedAt: discount ? addDays(start, -10) : null,
          createdAt: addDays(start, -10),
        };
        rows.feeInvoice.push(invoice);
        for (const n of items) {
          rows.feeInvoiceLine.push({
            id: newId(), invoiceId: invoice.id, feeItemId: feeItem[n].id, amount: amounts[n],
            note: n === "Transport" ? "School bus" : null,
          });
        }
        if (isCurrent) currentInvoices.push({ invoice, m });

        // Split what was paid into one to three instalments.
        if (paid > 0) {
          const parts = paid < 5000 ? 1 : randInt(1, 3);
          let left = paid;
          let when = addDays(start, -randInt(0, 7));
          for (let i = 0; i < parts; i++) {
            const amt = i === parts - 1 ? left : roundTo(left * (0.4 + rand() * 0.3), 100);
            left -= amt;
            const at = randomMomentBetween(when, i === 0 ? addDays(start, 21) : termEnd);
            addPayment(invoice, amt, at);
            when = at;
          }
        }
      }
    }
  }

  // Today's takings, so the dashboard's "collected today" is never empty.
  const owing = currentInvoices.filter(({ invoice, m }) => invoice.balance > 0 && m !== demoStudent);
  for (let i = 0; i < Math.min(9, owing.length); i++) {
    const { invoice } = owing.splice(randInt(0, owing.length - 1), 1)[0];
    const amt = Math.min(invoice.balance, roundTo(randInt(1000, 6000), 500));
    const at = atNairobi(TODAY, 8 + i, randInt(0, 50));
    addPayment(invoice, amt, at);
    invoice.paid += amt;
    invoice.balance -= amt;
    invoice.status = invoice.balance === 0 ? "PAID" : "PARTIALLY_PAID";
  }
  // One payment posted to the wrong student and reversed (kept for the trail).
  const wrongPosting = currentInvoices.find(({ invoice, m }) => invoice.balance > 3000 && m !== demoStudent);
  if (wrongPosting) {
    const { invoice } = wrongPosting;
    const at = randomMomentBetween(addDays(TODAY, -6), addDays(TODAY, -2));
    addPayment(invoice, 3000, at, {
      isReversed: true, reversedAt: addDays(at, 0.05), reversedBy: BURSAR_NAME,
      reversalReason: "Posted to the wrong student; re-posted to the correct account.",
    });
  }

  /* ---------- Attendance (this term, last 4 weeks + today) ---------- */
  const days = [];
  for (let d = addDays(TODAY, -1); days.length < 20 && d >= termStart(CURRENT_TERM); d = addDays(d, -1)) {
    if (isWeekday(d)) days.unshift(d);
  }
  days.push(TODAY);
  const DRAFT_TODAY = new Set(["Grade 7 East", "Grade 5"]);
  for (const d of days) {
    const isToday = d.getTime() === TODAY.getTime();
    const ageDays = Math.round((TODAY - d) / DAY);
    for (const c of classes) {
      const status = isToday ? (DRAFT_TODAY.has(c.label) ? "DRAFT" : "SUBMITTED") : ageDays > 5 ? "LOCKED" : "SUBMITTED";
      const taker = c.classTeacher.user;
      const createdAt = atNairobi(d, 8, randInt(0, 10));
      const submittedAt = status === "DRAFT" ? null : atNairobi(d, 8, randInt(15, 40));
      const lockedAt = status === "LOCKED" ? atNairobi(addDays(d, 2), 16, randInt(0, 30)) : null;
      const session = {
        id: newId(), schoolId: S, classId: c.id, date: d, year: YEAR, term: CURRENT_TERM, status,
        takenByUserId: taker.id, notes: null, submittedAt, lockedAt, createdAt, updatedAt: lockedAt || submittedAt || createdAt,
      };
      rows.attendanceSession.push(session);
      rows.attendanceEditLog.push({
        id: newId(), schoolId: S, sessionId: session.id, editedByUserId: taker.id, action: "CREATE_SESSION",
        before: null, after: { status: "DRAFT" }, createdAt,
      });
      if (submittedAt) {
        rows.attendanceEditLog.push({
          id: newId(), schoolId: S, sessionId: session.id, editedByUserId: taker.id, action: "SUBMIT_SESSION",
          before: { status: "DRAFT" }, after: { status: "SUBMITTED" }, createdAt: submittedAt,
        });
      }
      if (lockedAt) {
        rows.attendanceEditLog.push({
          id: newId(), schoolId: S, sessionId: session.id, editedByUserId: admin.id, action: "LOCK_SESSION",
          before: { status: "SUBMITTED" }, after: { status: "LOCKED" }, createdAt: lockedAt,
        });
      }
      for (const m of c.students) {
        let st = "PRESENT";
        let minutesLate = null;
        let comment = null;
        if (status !== "DRAFT") {
          const r = rand();
          if (r < m.absenceRate) {
            st = "ABSENT";
            comment = chance(0.4) ? pick(["Sick", "Family matter", "No reason given"]) : null;
          } else if (r < m.absenceRate + 0.04) {
            st = "LATE";
            minutesLate = randInt(5, 40);
          } else if (r < m.absenceRate + 0.05) {
            st = "EXCUSED";
            comment = pick(["Medical appointment", "Representing the school (sports)", "Parent's request"]);
          }
        }
        rows.attendanceRecord.push({
          id: newId(), schoolId: S, sessionId: session.id, studentId: m.row.id, status: st, minutesLate, comment,
          createdAt, updatedAt: submittedAt || createdAt,
        });
      }
    }
  }

  /* ---------- Exams ---------- */
  const EXAM_TYPES = [
    ["Opener", "OPN", 0.2, 1],
    ["Mid-Term", "MID", 0.3, 6],
    ["End-Term", "END", 0.5, 11],
  ];
  const examType = {};
  for (const [name, code, weight] of EXAM_TYPES) {
    const t = { id: newId(), schoolId: S, name, code, weight, isActive: true, createdAt: START_OF_YEAR };
    rows.examType.push(t);
    examType[name] = t;
  }
  const subjectDifficulty = { MAT: -6, ENG: 2, KIS: 4, SCI: -3, SST: 3, CRE: 7, CA: 8, AGR: 5, PTS: -1 };

  for (const term of TERMS_THIS_YEAR) {
    const start = termStart(term);
    const isCurrent = term === CURRENT_TERM;
    const wk = isCurrent ? weeksInto(term) : 13;

    for (const [typeName, , , week] of EXAM_TYPES) {
      // Which stage is this exam at? Past terms: all published.
      let stage;
      if (!isCurrent) stage = "published";
      else if (typeName === "Opener") stage = "published";
      else if (typeName === "Mid-Term") stage = wk >= 8 ? "published" : wk >= 3 ? "marking" : null;
      else stage = wk >= 13 ? "ready" : wk >= 10 ? "marking" : null;
      if (!stage) continue;

      // An exam that is being marked (or published) has already been sat.
      const startsOn = new Date(Math.min(addDays(start, week * 7).getTime(), addDays(TODAY, -6).getTime()));
      const endsOn = addDays(startsOn, 3);
      const createdAt = atNairobi(addDays(startsOn, -5), 10);
      const publishedAt =
        stage === "published"
          ? new Date(Math.min(atNairobi(addDays(endsOn, 9), 15).getTime(), NOW.getTime() - 60 * 60 * 1000))
          : null;

      for (const c of classes) {
        const session = {
          id: newId(), schoolId: S, year: YEAR, term, classId: c.id, examTypeId: examType[typeName].id,
          status: stage === "published" ? "PUBLISHED" : "DRAFT",
          name: `${typeName} exam, ${TERM_LABEL[term]}`, startsOn, endsOn,
          createdByUserId: admin.id, createdAt, publishedAt, publishedById: publishedAt ? admin.id : null,
        };
        rows.examSession.push(session);
        rows.examAuditLog.push({
          id: newId(), schoolId: S, actorUserId: admin.id, action: "CREATE", entityType: "ExamSession",
          entityId: session.id, before: null, after: { name: session.name }, createdAt,
        });

        for (const code of c.subjects) {
          const teacher = c.teacherFor[code];
          // While marking is going on, some marksheets are done and some are not.
          const isGracesOpenSheet = teacher === grace && c.label === "Grade 7 East" && code === "MAT";
          let sheetDone = stage !== "marking" ? true : isGracesOpenSheet ? false : chance(0.6);
          const fillRate = sheetDone ? 1 : isGracesOpenSheet ? 0.6 : 0.5 + rand() * 0.4;
          const submittedAt = sheetDone ? atNairobi(addDays(endsOn, randInt(2, 7)), randInt(9, 17)) : null;
          const sheet = {
            id: newId(), schoolId: S, examSessionId: session.id, subjectId: subjectByCode[code].id,
            teacherId: teacher.id, status: sheetDone ? "SUBMITTED" : "DRAFT",
            submittedAt: submittedAt && submittedAt < NOW ? submittedAt : submittedAt ? addDays(NOW, -0.1) : null,
            submittedById: sheetDone ? teacher.user.id : null, createdAt,
          };
          rows.markSheet.push(sheet);
          if (sheetDone) {
            rows.examAuditLog.push({
              id: newId(), schoolId: S, actorUserId: teacher.user.id, action: "SUBMIT", entityType: "MarkSheet",
              entityId: sheet.id, before: { status: "DRAFT" }, after: { status: "SUBMITTED" }, createdAt: sheet.submittedAt,
            });
          }
          for (const m of c.students) {
            const entered = sheetDone || rand() < fillRate;
            const typeShift = typeName === "End-Term" ? -3 : typeName === "Opener" ? 2 : 0;
            const score = entered
              ? Math.round(clamp(gauss(m.ability + subjectDifficulty[code] + typeShift, 7), 8, 99))
              : null;
            rows.mark.push({
              id: newId(), schoolId: S, markSheetId: sheet.id, studentId: m.row.id,
              score, isMissing: score == null, comment: null, createdAt,
            });
          }
        }

        if (publishedAt) {
          rows.examAuditLog.push({
            id: newId(), schoolId: S, actorUserId: admin.id, action: "PUBLISH", entityType: "ExamSession",
            entityId: session.id, before: { status: "DRAFT" }, after: { status: "PUBLISHED" }, createdAt: publishedAt,
          });
        }
      }
    }
  }

  /* ---------- Sign-in history for the audit log ---------- */
  for (let i = 13; i >= 0; i--) {
    const d = addDays(TODAY, -i);
    if (!isWeekday(d)) continue;
    for (const u of [admin, bursar, ...teachers.map((t) => t.user)]) {
      if (u.role === "TEACHER" && !chance(0.6)) continue;
      const at = atNairobi(d, 7, randInt(5, 58));
      if (at > NOW) continue;
      rows.auditLog.push({
        id: newId(), actorId: u.id, actorRole: u.role, actorEmail: u.email, schoolId: S,
        action: "AUTH_LOGIN_SUCCESS", targetType: null, targetId: null, metadata: null,
        ip: `198.51.100.${randInt(2, 250)}`, userAgent: "Demo", createdAt: at,
      });
    }
  }
  rows.auditLog.push({
    id: newId(), actorId: sysadmin.id, actorRole: "SYSTEM_ADMIN", actorEmail: sysadmin.email, schoolId: S,
    action: "SCHOOL_CREATED", targetType: "SCHOOL", targetId: S, metadata: { code: "MWA" },
    ip: "198.51.100.10", userAgent: "Demo", createdAt: START_OF_YEAR,
  });
  rows.auditLog.push({
    id: newId(), actorId: admin.id, actorRole: "ADMIN", actorEmail: admin.email, schoolId: S,
    action: "PRINT_SETTINGS_UPDATED", targetType: "SCHOOL", targetId: S, metadata: null,
    ip: "198.51.100.11", userAgent: "Demo", createdAt: addDays(START_OF_YEAR, 1),
  });

  /* ---------- Two smaller schools, so the platform view has a list ---------- */
  const others = [
    { code: "BJS", name: "Baraka Junior School", shortName: "Baraka", plan: "BASIC", status: "ACTIVE", maxStudents: 300, maxTeachers: 30, maxClasses: 15, maxUsers: 15, grades: [7, 8, 9], domain: "baraka" },
    { code: "TGS", name: "Tumaini Girls Secondary", shortName: "Tumaini", plan: "FREE", status: "TRIAL", maxStudents: 50, maxTeachers: 10, maxClasses: 5, maxUsers: null, grades: [1, 2], form: true, trialDays: 18, domain: "tumaini" },
  ];
  for (const o of others) {
    const school = addSchool({ ...o, contactEmail: `office@${o.domain}.invalid` });
    addSettings(school.id);
    addUser({ email: `admin@${o.domain}.invalid`, role: "ADMIN", schoolId: school.id, lastLoginAt: addDays(NOW, -randInt(1, 6)) });
    for (const g of o.grades) {
      const c = { id: newId(), schoolId: school.id, name: o.form ? `Form ${g}` : `Grade ${g}`, stream: null, year: YEAR, isActive: true, createdAt: START_OF_YEAR };
      rows.class.push(c);
      const n = randInt(12, 18);
      for (let i = 0; i < n; i++) {
        const gender = o.form ? "F" : chance(0.5) ? "F" : "M";
        rows.student.push({
          id: newId(), schoolId: school.id, admissionNo: `${o.code}-${100 + rows.student.length}`, ...nextName(gender), gender,
          dob: null, classId: c.id, isActive: true, userId: null, createdAt: START_OF_YEAR,
        });
      }
    }
  }

  return { mwa, sysadmin };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */
// Insert order follows the foreign keys.
const ORDER = [
  "school", "schoolSettings", "subscription", "user", "teacher", "class", "student", "subject",
  "classTeacher", "teachingAssignment", "feeItem", "feePlan", "feePlanItem", "feeInvoice",
  "feeInvoiceLine", "feePayment", "attendanceSession", "attendanceRecord", "attendanceEditLog",
  "examType", "examSession", "markSheet", "mark", "examAuditLog", "auditLog",
];

async function emptyDatabase() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main() {
  const started = Date.now();
  console.log(`Building the demo in "${dbNameOf(DB_URL)}" on ${hostOf(DB_URL)} (${CURRENT_TERM}, ${TODAY.toISOString().slice(0, 10)})`);

  const existing = await prisma.user.count();
  if (existing > 0 && !args.has("--reset")) {
    console.error("The demo database already has data. Add --reset to empty it and rebuild.");
    process.exit(1);
  }

  // Nobody signs in with a password in the demo (it has one-click sign-in),
  // so every account gets the same long random one that nobody knows.
  PASSWORD_HASH = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10);

  const { mwa, sysadmin } = build();

  if (args.has("--reset")) {
    await emptyDatabase();
    console.log("Emptied the demo database.");
  }

  for (const model of ORDER) {
    const data = rows[model];
    for (let i = 0; i < data.length; i += 1000) {
      await prisma[model].createMany({ data: data.slice(i, i + 1000) });
    }
    console.log(`  ${model.padEnd(20)} ${data.length}`);
  }

  // A backup snapshot, so the platform admin's Backups tab has something in it.
  try {
    const { createSchoolBackup } = await import("../src/services/backup.service.js");
    await createSchoolBackup({ schoolId: mwa.id, actorId: sysadmin.id });
    console.log("  backup               1");
  } catch (e) {
    console.warn("  (backup skipped:", e.message, ")");
  }

  console.log(`Demo ready in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((e) => {
    console.error("Demo seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // backup.service.js has its own Prisma client; make sure nothing keeps the process alive.
    setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
  });
