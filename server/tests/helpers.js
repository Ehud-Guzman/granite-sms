// Shared fixtures for integration tests.
// Every call to makeSchool() creates a fresh school with unique ids, so test
// files never share rows and can run in parallel against one database.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { signToken } from "../src/utils/jwt.js";

export { app, prisma, request };

const ALL_ENTITLEMENTS = {
  FEES_READ: true,
  FEES_WRITE: true,
  EXAMS_READ: true,
  EXAMS_WRITE: true,
  ATTENDANCE_READ: true,
  ATTENDANCE_WRITE: true,
};

export const TEST_PASSWORD = "Passw0rd-Test";
let passwordHash;

function uid() {
  return crypto.randomBytes(5).toString("hex");
}

export function tokenFor(user) {
  return signToken({
    sub: user.id,
    role: user.role,
    schoolId: user.role === "SYSTEM_ADMIN" ? null : user.schoolId,
    tokenVersion: user.tokenVersion ?? 0,
  });
}

/** Authorized supertest request: as(user).get("/api/...") */
export function as(user) {
  const auth = (r) => r.set("Authorization", `Bearer ${tokenFor(user)}`);
  return {
    get: (url) => auth(request(app).get(url)),
    post: (url) => auth(request(app).post(url)),
    patch: (url) => auth(request(app).patch(url)),
    put: (url) => auth(request(app).put(url)),
    delete: (url) => auth(request(app).delete(url)),
  };
}

async function makeUser(schoolId, role, extra = {}) {
  passwordHash ||= await bcrypt.hash(TEST_PASSWORD, 4);
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${uid()}@test.invalid`,
      password: passwordHash,
      role,
      schoolId,
      isActive: true,
      mustChangePassword: false,
      ...extra,
    },
  });
}

/**
 * A complete little school: admin, second admin, bursar, two teachers
 * (one class teacher), one class with 3 students (one with a STUDENT login),
 * a fee item + plan for 2026 TERM1, and one unpaid invoice of 17,000.
 */
export async function makeSchool() {
  const id = `t${uid()}`;
  const school = await prisma.school.create({ data: { id, name: `Test School ${id}`, code: id } });
  await prisma.subscription.create({
    data: {
      schoolId: id,
      planCode: "PRO",
      status: "ACTIVE",
      maxStudents: 1000,
      maxTeachers: 100,
      maxClasses: 100,
      entitlements: ALL_ENTITLEMENTS,
    },
  });
  await prisma.schoolSettings.create({ data: { schoolId: id, currentAcademicYear: "2026" } });

  const admin = await makeUser(id, "ADMIN");
  const admin2 = await makeUser(id, "ADMIN");
  const bursar = await makeUser(id, "BURSAR");
  const teacherUser = await makeUser(id, "TEACHER");
  const teacher2User = await makeUser(id, "TEACHER");
  const teacher = await prisma.teacher.create({
    data: { schoolId: id, userId: teacherUser.id, firstName: "Tess", lastName: "Teacher" },
  });
  const teacher2 = await prisma.teacher.create({
    data: { schoolId: id, userId: teacher2User.id, firstName: "Tom", lastName: "Other" },
  });

  const klass = await prisma.class.create({ data: { schoolId: id, name: "Grade 7", stream: "E", year: 2026 } });
  const otherClass = await prisma.class.create({ data: { schoolId: id, name: "Grade 8", stream: "E", year: 2026 } });
  await prisma.classTeacher.create({ data: { schoolId: id, classId: klass.id, teacherId: teacher.id, isActive: true } });

  const studentUser = await makeUser(id, "STUDENT");
  const students = [];
  for (let i = 0; i < 3; i++) {
    students.push(
      await prisma.student.create({
        data: {
          schoolId: id,
          admissionNo: `ADM-${i + 1}`,
          firstName: `Student${i + 1}`,
          lastName: "Test",
          classId: klass.id,
          userId: i === 0 ? studentUser.id : null,
        },
      })
    );
  }

  const feeItem = await prisma.feeItem.create({ data: { schoolId: id, name: "Tuition" } });
  const plan = await prisma.feePlan.create({
    data: {
      schoolId: id,
      classId: klass.id,
      year: 2026,
      term: "TERM1",
      items: { create: [{ feeItemId: feeItem.id, amount: 17000 }] },
    },
  });
  const invoice = await prisma.feeInvoice.create({
    data: {
      schoolId: id,
      studentId: students[0].id,
      classId: klass.id,
      year: 2026,
      term: "TERM1",
      invoiceNo: `INV-${id}`,
      status: "ISSUED",
      total: 17000,
      paid: 0,
      balance: 17000,
      lines: { create: [{ feeItemId: feeItem.id, amount: 17000 }] },
    },
  });

  const reload = (u) => prisma.user.findUnique({ where: { id: u.id } });
  return {
    school,
    admin: await reload(admin),
    admin2: await reload(admin2),
    bursar: await reload(bursar),
    teacher: { ...(await reload(teacherUser)), teacherId: teacher.id },
    teacher2: { ...(await reload(teacher2User)), teacherId: teacher2.id },
    studentUser: await reload(studentUser),
    klass,
    otherClass,
    students,
    feeItem,
    plan,
    invoice,
  };
}

/** A platform owner (SYSTEM_ADMIN). Use with .set("x-school-id", id) for tenant routes. */
export async function makeSystemAdmin() {
  return makeUser(null, "SYSTEM_ADMIN");
}

/** Sum of non-reversed payments on an invoice, straight from the payment rows. */
export async function paymentsTotal(invoiceId) {
  const agg = await prisma.feePayment.aggregate({
    where: { invoiceId, isReversed: false },
    _sum: { amount: true },
  });
  return agg._sum.amount || 0;
}
