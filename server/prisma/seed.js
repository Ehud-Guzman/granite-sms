// prisma/seed.js
import bcrypt from "bcrypt";
import { PrismaClient, Role, Term, PaymentMethod, SubscriptionStatus, PlanCode, InvoiceStatus } from "@prisma/client";

const prisma = new PrismaClient();

const YEAR = 2026;
const TERM = Term.TERM1;

function nowPlusDays(d) {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x;
}

async function hash(pw) {
  const saltRounds = 10;
  return bcrypt.hash(pw, saltRounds);
}

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  const firstName = parts[0] || "User";
  const lastName = parts.slice(1).join(" ") || "Unknown";
  return { firstName, lastName };
}

async function upsertSchool({ code, name, shortName }) {
  return prisma.school.upsert({
    where: { code },
    update: { name, shortName, isActive: true },
    create: { code, name, shortName, isActive: true },
  });
}

async function ensureSettings(schoolId, extra = {}) {
  return prisma.schoolSettings.upsert({
    where: { schoolId },
    update: { ...extra },
    create: {
      schoolId,
      enableClassTeachers: true,
      enableSubjectAssignments: true,
      term1Label: "Term 1",
      term2Label: "Term 2",
      term3Label: "Term 3",
      currentAcademicYear: String(YEAR),
      ...extra,
    },
  });
}

async function ensureSubscription(schoolId, planCode = PlanCode.BASIC) {
  return prisma.subscription.create({
    data: {
      schoolId,
      status: SubscriptionStatus.ACTIVE,
      planCode,
      // reasonable dev limits (tune as you like)
      maxStudents: 500,
      maxTeachers: 50,
      maxClasses: 50,
      limits: { classes: 50, teachers: 50, students: 500, fees: true },
      entitlements: { FEES_WRITE: true },
      startsAt: new Date(),
      currentPeriodEnd: nowPlusDays(30),
    },
  });
}

async function ensureUser({ email, password, role, schoolId = null, mustChangePassword = false, isActive = true }) {
  const pwHash = await hash(password);

  return prisma.user.upsert({
    where: { email },
    update: {
      password: pwHash,
      role,
      schoolId,
      isActive,
      mustChangePassword,
    },
    create: {
      email,
      password: pwHash,
      role,
      schoolId,
      isActive,
      mustChangePassword,
    },
  });
}

async function ensureTeacher({ schoolId, email, fullName, phone = null }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Teacher user not found: ${email}`);

  const { firstName, lastName } = splitName(fullName);

  return prisma.teacher.upsert({
    where: { userId: user.id },
    update: { schoolId, firstName, lastName, phone },
    create: { schoolId, userId: user.id, firstName, lastName, phone },
  });
}

async function ensureClass({ schoolId, name, stream = null, year = YEAR }) {
  const s = stream == null ? null : String(stream).trim();

  // Prisma can't upsert on a composite unique if one field is null.
  // For null streams, do findFirst -> update/create.
  if (s === null) {
    const existing = await prisma.class.findFirst({
      where: { schoolId, name, year, stream: null },
    });

    if (existing) {
      return prisma.class.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }

    return prisma.class.create({
      data: { schoolId, name, stream: null, year, isActive: true },
    });
  }

  // Non-null stream can safely use the composite unique upsert
  return prisma.class.upsert({
    where: {
      schoolId_name_stream_year: {
        schoolId,
        name,
        stream: s,
        year,
      },
    },
    update: { isActive: true },
    create: { schoolId, name, stream: s, year, isActive: true },
  });
}


async function ensureSubject({ schoolId, name, code = null }) {
  // schema has @@unique([schoolId, name]) and @@unique([schoolId, code])
  return prisma.subject.upsert({
    where: { schoolId_name: { schoolId, name } },
    update: { isActive: true, code },
    create: { schoolId, name, code, isActive: true },
  });
}

async function ensureAssignment({ schoolId, teacherId, classId, subjectId }) {
  return prisma.teachingAssignment.upsert({
    where: {
      schoolId_teacherId_classId_subjectId: {
        schoolId,
        teacherId,
        classId,
        subjectId,
      },
    },
    update: { isActive: true },
    create: { schoolId, teacherId, classId, subjectId, isActive: true },
  });
}

async function ensureClassTeacher({ schoolId, classId, teacherId }) {
  return prisma.classTeacher.upsert({
    where: { schoolId_classId: { schoolId, classId } },
    update: { teacherId, isActive: true },
    create: { schoolId, classId, teacherId, isActive: true },
  });
}

async function ensureStudent({ schoolId, admissionNo, firstName, lastName, gender = null, classId = null, isActive = true }) {
  return prisma.student.upsert({
    where: { schoolId_admissionNo: { schoolId, admissionNo } },
    update: { firstName, lastName, gender, classId, isActive },
    create: { schoolId, admissionNo, firstName, lastName, gender, classId, isActive },
  });
}

async function ensureFeeItem({ schoolId, name }) {
  return prisma.feeItem.upsert({
    where: { schoolId_name: { schoolId, name } },
    update: { isActive: true },
    create: { schoolId, name, isActive: true },
  });
}

async function ensureFeePlan({ schoolId, classId, year = YEAR, term = TERM, title }) {
  return prisma.feePlan.upsert({
    where: { schoolId_classId_year_term: { schoolId, classId, year, term } },
    update: { title, isActive: true },
    create: { schoolId, classId, year, term, title, isActive: true },
  });
}

async function ensureFeePlanItem({ feePlanId, feeItemId, amount, required = true }) {
  return prisma.feePlanItem.upsert({
    where: { feePlanId_feeItemId: { feePlanId, feeItemId } },
    update: { amount, required },
    create: { feePlanId, feeItemId, amount, required },
  });
}

function makeInvoiceNo(prefix, n) {
  return `${prefix}-${YEAR}-${String(n).padStart(4, "0")}`;
}

function makeReceiptNo(prefix, n) {
  return `${prefix}-RCT-${YEAR}-${String(n).padStart(5, "0")}`;
}

function makeClientTxnId(prefix, n) {
  return `${prefix}-TXN-${YEAR}-${String(n).padStart(6, "0")}`;
}

async function createInvoiceWithLines({
  schoolId,
  studentId,
  classId,
  year = YEAR,
  term = TERM,
  invoiceNo,
  lines, // [{ feeItemId, amount, note? }]
  status = InvoiceStatus.ISSUED,
}) {
  const total = lines.reduce((s, x) => s + x.amount, 0);

  const invoice = await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId,
      classId,
      year,
      term,
      invoiceNo,
      status,
      total,
      paid: 0,
      balance: total,
      lines: {
        create: lines.map((l) => ({
          feeItemId: l.feeItemId,
          amount: l.amount,
          note: l.note || null,
        })),
      },
    },
    include: { lines: true },
  });

  return invoice;
}

async function applyPayment({
  schoolId,
  invoiceId,
  amount,
  method = PaymentMethod.CASH,
  reference = null,
  receivedBy = null,
  receiptNo,
  clientTxnId,
  isReversal = false,
  reversalReason = null,
}) {
  // create payment
  const payment = await prisma.feePayment.create({
    data: {
      schoolId,
      invoiceId,
      amount,
      method,
      reference,
      receivedBy,
      receiptNo,
      clientTxnId,
      receiptIssuedAt: new Date(),
      receivedAt: new Date(),
      ...(isReversal
        ? {
            isReversed: true,
            reversedAt: new Date(),
            reversedBy: receivedBy || null,
            reversalReason: reversalReason || "Reversal",
          }
        : {}),
    },
  });

  // recompute invoice totals safely (exclude reversed payments)
  const invoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found while applying payment");

  const payments = await prisma.feePayment.findMany({
    where: { invoiceId, schoolId },
  });

  const paid = payments
    .filter((p) => !p.isReversed)
    .reduce((s, p) => s + p.amount, 0);

  const balance = Math.max(invoice.total - paid, 0);

  let status = invoice.status;
  if (invoice.status !== InvoiceStatus.VOID) {
    if (paid <= 0) status = InvoiceStatus.ISSUED;
    else if (balance <= 0) status = InvoiceStatus.PAID;
    else status = InvoiceStatus.PARTIALLY_PAID;
  }

  await prisma.feeInvoice.update({
    where: { id: invoiceId },
    data: { paid, balance, status },
  });

  return payment;
}

async function main() {
  console.log("🌱 Seeding start...");

  // -------------------------
  // SCHOOLS (real)
  // -------------------------
  const kps = await upsertSchool({
    code: "KPS",
    name: "Kutus Primary School",
    shortName: "KPS",
  });

  const kmt = await upsertSchool({
    code: "KMT",
    name: "Kiamutugu Boys High School",
    shortName: "KMT",
  });

  // Settings + subscription
  await ensureSettings(kps.id, {
    contactEmail: "kutusprimary@gmail.com",
  }).catch(() => null);

  await ensureSettings(kmt.id, {
    contactEmail: "kmt@example.com",
  }).catch(() => null);

  // Subscriptions: remove old ones for clean reset behavior
  await prisma.subscription.deleteMany({ where: { schoolId: { in: [kps.id, kmt.id] } } });
  await ensureSubscription(kps.id, PlanCode.BASIC);
  await ensureSubscription(kmt.id, PlanCode.BASIC);

  // -------------------------
  // USERS (real)
  // -------------------------
  // SYSTEM ADMIN (global)
  await ensureUser({
    email: "nyamuehud@gmail.com",
    password: "Ehudmwai2000.",
    role: Role.SYSTEM_ADMIN,
    schoolId: null,
    mustChangePassword: false,
  });

  // KPS Admin
  await ensureUser({
    email: "kutusprimary@gmail.com",
    password: "Kutus1234",
    role: Role.ADMIN,
    schoolId: kps.id,
  });

  // KPS Bursar
  await ensureUser({
    email: "kutusaccounts@gmail.com",
    password: "kutusaccounts123",
    role: Role.BURSAR,
    schoolId: kps.id,
  });

  // KPS Teachers
  await ensureUser({
    email: "guzman@gmail.com",
    password: "guzman123",
    role: Role.TEACHER,
    schoolId: kps.id,
  });

  await ensureUser({
    email: "nyamu@gmail.com",
    password: "nyamu123",
    role: Role.TEACHER,
    schoolId: kps.id,
  });

  const tGuzman = await ensureTeacher({
    schoolId: kps.id,
    email: "guzman@gmail.com",
    fullName: "Ehud Guzman",
  });

  const tNyamu = await ensureTeacher({
    schoolId: kps.id,
    email: "nyamu@gmail.com",
    fullName: "Paul Nyamu",
  });

  // -------------------------
  // CLASSES
  // -------------------------
  // Primary: CBC-ish grades (keep simple but real)
  const kpsG4 = await ensureClass({ schoolId: kps.id, name: "Grade 4", stream: null, year: YEAR });
  const kpsG5 = await ensureClass({ schoolId: kps.id, name: "Grade 5", stream: null, year: YEAR });
  const kpsG6 = await ensureClass({ schoolId: kps.id, name: "Grade 6", stream: null, year: YEAR });

  // Highschool: streams C/E/M
  const kmtF1C = await ensureClass({ schoolId: kmt.id, name: "Form 1", stream: "C", year: YEAR });
  const kmtF1E = await ensureClass({ schoolId: kmt.id, name: "Form 1", stream: "E", year: YEAR });
  const kmtF1M = await ensureClass({ schoolId: kmt.id, name: "Form 1", stream: "M", year: YEAR });

  // -------------------------
  // SUBJECTS
  // -------------------------
  // Highschool subjects
  const hsSubjects = [
    "Mathematics",
    "English",
    "Kiswahili",
    "Physics",
    "Chemistry",
    "Biology",
    "Computer Studies",
  ];

  for (const s of hsSubjects) await ensureSubject({ schoolId: kmt.id, name: s });

  // Primary CBC-ish (simplified but realistic)
  const primarySubjects = [
    "Mathematics",
    "English",
    "Kiswahili",
    "Science & Technology",
    "Social Studies",
    "CRE",
    "Agriculture",
    "Art & Craft",
    "Music",
    "ICT",
  ];
  for (const s of primarySubjects) await ensureSubject({ schoolId: kps.id, name: s });

  // -------------------------
  // ASSIGNMENTS + CLASS TEACHER (KPS side)
  // -------------------------
  // Assign Guzman to Grade 4 Math + English
  const subKpsMath = await prisma.subject.findFirst({ where: { schoolId: kps.id, name: "Mathematics" } });
  const subKpsEng = await prisma.subject.findFirst({ where: { schoolId: kps.id, name: "English" } });
  const subKpsSci = await prisma.subject.findFirst({ where: { schoolId: kps.id, name: "Science & Technology" } });

  if (subKpsMath) await ensureAssignment({ schoolId: kps.id, teacherId: tGuzman.id, classId: kpsG4.id, subjectId: subKpsMath.id });
  if (subKpsEng) await ensureAssignment({ schoolId: kps.id, teacherId: tGuzman.id, classId: kpsG4.id, subjectId: subKpsEng.id });
  if (subKpsSci) await ensureAssignment({ schoolId: kps.id, teacherId: tNyamu.id, classId: kpsG4.id, subjectId: subKpsSci.id });

  // Class teacher mapping
  await ensureClassTeacher({ schoolId: kps.id, classId: kpsG4.id, teacherId: tGuzman.id });

  // -------------------------
  // STUDENTS (realistic edge cases)
  // -------------------------
  const kpsStudents = [
    { admissionNo: "KPS-0001", firstName: "Faith", lastName: "Wambui", gender: "F" },
    { admissionNo: "KPS-0002", firstName: "Brian", lastName: "Mwangi", gender: "M" },
    { admissionNo: "KPS-0003", firstName: "Joy", lastName: "Njeri", gender: "F" },
    // long names
    { admissionNo: "KPS-0004", firstName: "Maryanne", lastName: "Wanjiku Nyambura Wairimu", gender: "F" },
    // missing optional fields (gender null)
    { admissionNo: "KPS-0005", firstName: "Kevin", lastName: "Omondi", gender: null },
    // inactive student
    { admissionNo: "KPS-0006", firstName: "Stephen", lastName: "Kariuki", gender: "M", isActive: false },
  ];

  const kpsStudentRows = [];
  for (const s of kpsStudents) {
    const row = await ensureStudent({
      schoolId: kps.id,
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      gender: s.gender ?? null,
      classId: kpsG4.id,
      isActive: s.isActive ?? true,
    });
    kpsStudentRows.push(row);
  }

  const kmtStudents = [
    { admissionNo: "KMT-0101", firstName: "James", lastName: "Mutua", gender: "M" },
    { admissionNo: "KMT-0102", firstName: "Kevin", lastName: "Odhiambo", gender: "M" },
    { admissionNo: "KMT-0103", firstName: "Peter", lastName: "Kiptoo", gender: "M" },
    { admissionNo: "KMT-0104", firstName: "John", lastName: "Muriithi", gender: "M" },
  ];

  const kmtStudentRows = [];
  for (const s of kmtStudents) {
    const row = await ensureStudent({
      schoolId: kmt.id,
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      gender: s.gender ?? null,
      classId: kmtF1C.id, // default to Form 1C
      isActive: true,
    });
    kmtStudentRows.push(row);
  }

  // -------------------------
  // FEES: Items + Plan + Scenarios
  // -------------------------
  const feeItemNames = ["Tuition", "Development", "Lunch", "Exams", "ICT"];
  const feeItemsKps = {};
  const feeItemsKmt = {};

  for (const name of feeItemNames) {
    feeItemsKps[name] = await ensureFeeItem({ schoolId: kps.id, name });
    feeItemsKmt[name] = await ensureFeeItem({ schoolId: kmt.id, name });
  }

  // Plans (one per main class per term)
  const kpsPlan = await ensureFeePlan({
    schoolId: kps.id,
    classId: kpsG4.id,
    year: YEAR,
    term: TERM,
    title: "Grade 4 Term 1 Fees",
  });

  const kmtPlan = await ensureFeePlan({
    schoolId: kmt.id,
    classId: kmtF1C.id,
    year: YEAR,
    term: TERM,
    title: "Form 1 Term 1 Fees",
  });

  // Plan items amounts (reasonable placeholders)
  await ensureFeePlanItem({ feePlanId: kpsPlan.id, feeItemId: feeItemsKps["Tuition"].id, amount: 12000, required: true });
  await ensureFeePlanItem({ feePlanId: kpsPlan.id, feeItemId: feeItemsKps["Development"].id, amount: 2500, required: true });
  await ensureFeePlanItem({ feePlanId: kpsPlan.id, feeItemId: feeItemsKps["Exams"].id, amount: 1500, required: true });
  await ensureFeePlanItem({ feePlanId: kpsPlan.id, feeItemId: feeItemsKps["ICT"].id, amount: 1000, required: false });

  await ensureFeePlanItem({ feePlanId: kmtPlan.id, feeItemId: feeItemsKmt["Tuition"].id, amount: 18000, required: true });
  await ensureFeePlanItem({ feePlanId: kmtPlan.id, feeItemId: feeItemsKmt["Development"].id, amount: 4000, required: true });
  await ensureFeePlanItem({ feePlanId: kmtPlan.id, feeItemId: feeItemsKmt["Exams"].id, amount: 2500, required: true });
  await ensureFeePlanItem({ feePlanId: kmtPlan.id, feeItemId: feeItemsKmt["Lunch"].id, amount: 3500, required: false });

  // Clean existing invoices/payments for these students in this term (makes seed rerunnable)
  await prisma.feePayment.deleteMany({
    where: { schoolId: { in: [kps.id, kmt.id] } },
  });
  await prisma.feeInvoiceLine.deleteMany({
    where: { invoice: { schoolId: { in: [kps.id, kmt.id] } } },
  });
  await prisma.feeInvoice.deleteMany({
    where: { schoolId: { in: [kps.id, kmt.id] }, year: YEAR, term: TERM },
  });

  // --- KPS scenarios ---
  // Student A: fully paid
  // Student B: partially paid (2 payments)
  // Student C: not paid
  // Student D: reversed payment

  const kpsInvoice1 = await createInvoiceWithLines({
    schoolId: kps.id,
    studentId: kpsStudentRows[0].id,
    classId: kpsG4.id,
    invoiceNo: makeInvoiceNo("KPS", 1),
    lines: [
      { feeItemId: feeItemsKps["Tuition"].id, amount: 12000 },
      { feeItemId: feeItemsKps["Development"].id, amount: 2500 },
      { feeItemId: feeItemsKps["Exams"].id, amount: 1500 },
    ],
  });

  await applyPayment({
    schoolId: kps.id,
    invoiceId: kpsInvoice1.id,
    amount: kpsInvoice1.total,
    method: PaymentMethod.MPESA,
    reference: "MPESA-KPS-0001",
    receivedBy: "Kutus Accountant",
    receiptNo: makeReceiptNo("KPS", 1),
    clientTxnId: makeClientTxnId("KPS", 1),
  });

  const kpsInvoice2 = await createInvoiceWithLines({
    schoolId: kps.id,
    studentId: kpsStudentRows[1].id,
    classId: kpsG4.id,
    invoiceNo: makeInvoiceNo("KPS", 2),
    lines: [
      { feeItemId: feeItemsKps["Tuition"].id, amount: 12000 },
      { feeItemId: feeItemsKps["Development"].id, amount: 2500 },
      { feeItemId: feeItemsKps["Exams"].id, amount: 1500 },
      { feeItemId: feeItemsKps["ICT"].id, amount: 1000, note: "Optional ICT fee" },
    ],
  });

  await applyPayment({
    schoolId: kps.id,
    invoiceId: kpsInvoice2.id,
    amount: 8000,
    method: PaymentMethod.CASH,
    reference: null,
    receivedBy: "Kutus Accountant",
    receiptNo: makeReceiptNo("KPS", 2),
    clientTxnId: makeClientTxnId("KPS", 2),
  });

  await applyPayment({
    schoolId: kps.id,
    invoiceId: kpsInvoice2.id,
    amount: 3000,
    method: PaymentMethod.MPESA,
    reference: "MPESA-KPS-0002",
    receivedBy: "Kutus Accountant",
    receiptNo: makeReceiptNo("KPS", 3),
    clientTxnId: makeClientTxnId("KPS", 3),
  });

  const kpsInvoice3 = await createInvoiceWithLines({
    schoolId: kps.id,
    studentId: kpsStudentRows[2].id,
    classId: kpsG4.id,
    invoiceNo: makeInvoiceNo("KPS", 3),
    lines: [
      { feeItemId: feeItemsKps["Tuition"].id, amount: 12000 },
      { feeItemId: feeItemsKps["Development"].id, amount: 2500 },
    ],
  });
  // no payment => unpaid

  const kpsInvoice4 = await createInvoiceWithLines({
    schoolId: kps.id,
    studentId: kpsStudentRows[3].id,
    classId: kpsG4.id,
    invoiceNo: makeInvoiceNo("KPS", 4),
    lines: [
      { feeItemId: feeItemsKps["Tuition"].id, amount: 12000 },
      { feeItemId: feeItemsKps["Exams"].id, amount: 1500 },
    ],
  });

  // pay then reverse
  const pay1 = await applyPayment({
    schoolId: kps.id,
    invoiceId: kpsInvoice4.id,
    amount: 5000,
    method: PaymentMethod.MPESA,
    reference: "MPESA-KPS-REV-01",
    receivedBy: "Kutus Accountant",
    receiptNo: makeReceiptNo("KPS", 4),
    clientTxnId: makeClientTxnId("KPS", 4),
  });

  // reverse by creating a reversed payment record (keeps trail)
  await applyPayment({
    schoolId: kps.id,
    invoiceId: kpsInvoice4.id,
    amount: pay1.amount,
    method: PaymentMethod.MPESA,
    reference: pay1.reference,
    receivedBy: "Kutus Accountant",
    receiptNo: makeReceiptNo("KPS", 5),
    clientTxnId: makeClientTxnId("KPS", 5),
    isReversal: true,
    reversalReason: "Wrong student credited",
  });

  // --- KMT scenarios (simple mirror) ---
  const kmtInvoice1 = await createInvoiceWithLines({
    schoolId: kmt.id,
    studentId: kmtStudentRows[0].id,
    classId: kmtF1C.id,
    invoiceNo: makeInvoiceNo("KMT", 1),
    lines: [
      { feeItemId: feeItemsKmt["Tuition"].id, amount: 18000 },
      { feeItemId: feeItemsKmt["Development"].id, amount: 4000 },
      { feeItemId: feeItemsKmt["Exams"].id, amount: 2500 },
    ],
  });

  await applyPayment({
    schoolId: kmt.id,
    invoiceId: kmtInvoice1.id,
    amount: 10000,
    method: PaymentMethod.BANK,
    reference: "BANK-KMT-0001",
    receivedBy: "Bursar",
    receiptNo: makeReceiptNo("KMT", 1),
    clientTxnId: makeClientTxnId("KMT", 1),
  });

  console.log("✅ Seeding done.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
