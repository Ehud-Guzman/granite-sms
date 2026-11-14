// Audit 2 speed fix (A2-PERF-01, A2-PERF-03): the dashboard cache and when
// it clears, the paged collections report, and the live results engine.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { recordMpesaPayment } from "../src/modules/mpesa/ingest.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
  await prisma.schoolSettings.update({ where: { schoolId: s.school.id }, data: { currentTerm: "TERM1", currentAcademicYear: "2026" } });
});

const summary = async (u) => (await as(u).get("/api/dashboard/summary")).body.data;
const nairobiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

describe("dashboard summary cache", () => {
  it("serves repeat loads from the cache, so writes that skip the API don't show at once", async () => {
    const first = await summary(s.bursar);
    expect(first.fees.collectedToday).toBe(0);
    // Straight into the database: nothing clears the cache.
    await prisma.feePayment.create({
      data: { schoolId: s.school.id, studentId: s.students[1].id, amount: 300, method: "CASH", receiptNo: `RAW-${s.school.id}` },
    });
    const again = await summary(s.bursar);
    expect(again.fees.collectedToday).toBe(0);
    expect(again.meta.computedAt).toBe(first.meta.computedAt);
  });

  it("clears after a payment is posted or reversed through the API", async () => {
    expect((await summary(s.admin)).fees.collectedToday).toBe(0);
    const pay = await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 5000 });
    expect(pay.status).toBeLessThan(300);
    const after = await summary(s.admin);
    expect(after.fees).toMatchObject({ collectedToday: 5000, receiptsToday: 1, outstandingTotal: 12000 });

    const paymentId = pay.body.payment?.id || pay.body.id || pay.body.data?.id;
    const rev = await as(s.admin).post(`/api/fees/payments/${paymentId}/reverse`).send({ reason: "Entered twice by mistake" });
    expect(rev.status).toBeLessThan(300);
    expect((await summary(s.admin)).fees).toMatchObject({ collectedToday: 0, outstandingTotal: 17000 });
  });

  it("clears when an M-Pesa payment arrives without a signed-in user", async () => {
    expect((await summary(s.bursar)).fees.collectedToday).toBe(0);
    const r = await recordMpesaPayment({
      schoolId: s.school.id,
      transId: `TX${Date.now()}`,
      amount: 2500,
      billRef: s.students[0].admissionNo,
      msisdn: "254700000001",
      transTime: "20261112083045",
    });
    expect(r.paymentId).toBeTruthy();
    expect((await summary(s.bursar)).fees.outstandingTotal).toBe(14500);
  });

  it("keeps each teacher's summary to their own classes", async () => {
    // teacher2 teaches only the other class.
    const teacher2 = await prisma.teacher.findFirst({ where: { schoolId: s.school.id, id: s.teacher2.teacherId } });
    await prisma.classTeacher.create({ data: { schoolId: s.school.id, classId: s.otherClass.id, teacherId: teacher2.id, isActive: true } });

    const one = await summary(s.teacher);
    const two = await summary(s.teacher2);
    expect(one.attendanceToday.notMarked.map((c) => c.classId)).toEqual([s.klass.id]);
    expect(two.attendanceToday.notMarked.map((c) => c.classId)).toEqual([s.otherClass.id]);
    // Cached per teacher, not per role.
    expect((await summary(s.teacher)).attendanceToday.notMarked.map((c) => c.classId)).toEqual([s.klass.id]);
  });
});

describe("security overview (A2-DATA-04)", () => {
  it("counts today's sign-ins from the school's midnight, not the server's", async () => {
    const { startOfLocalDay } = await import("../src/utils/schoolTime.js");
    const start = startOfLocalDay(nairobiToday(), "Africa/Nairobi");
    const log = (ms) =>
      prisma.auditLog.create({ data: { schoolId: s.school.id, action: "LOGIN_SUCCESS", actorRole: "ADMIN", createdAt: new Date(start.getTime() + ms) } });
    await log(60_000); // just after midnight in Nairobi
    await log(-60_000); // just before: yesterday
    const r = await as(s.admin).get("/api/settings/security/overview");
    expect(r.status).toBe(200);
    expect(r.body.today.loginSuccess).toBe(1);
  });
});

describe("collections report", () => {
  it("sums the whole range in the database and sends the receipts a page at a time", async () => {
    const today = nairobiToday();
    for (const [i, amount] of [1000, 2000, 3000].entries()) {
      await prisma.feePayment.create({
        data: {
          schoolId: s.school.id,
          studentId: s.students[0].id,
          amount,
          method: i === 2 ? "MPESA" : "CASH",
          receiptNo: `C-${i}-${s.school.id}`,
          receivedAt: new Date(Date.now() - i * 1000),
        },
      });
    }
    await prisma.feePayment.create({
      data: { schoolId: s.school.id, studentId: s.students[0].id, amount: 9999, method: "CASH", receiptNo: `REV-${s.school.id}`, isReversed: true },
    });

    const url = `/api/fees/reports/collections?from=${today}&to=${today}`;
    const p1 = await as(s.bursar).get(`${url}&pageSize=2`);
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({
      totalCollected: 6000,
      count: 3,
      page: 1,
      pageSize: 2,
      byMethod: { CASH: 3000, MPESA: 3000 },
      byDay: [{ date: today, amount: 6000, receipts: 3 }],
    });
    expect(p1.body.payments.map((p) => p.amount)).toEqual([1000, 2000]); // newest first

    const p2 = await as(s.bursar).get(`${url}&pageSize=2&page=2`);
    expect(p2.body.payments.map((p) => p.amount)).toEqual([3000]);
    expect(p2.body.totalCollected).toBe(6000);

    // The export still has every receipt.
    const csv = await as(s.bursar).get(`${url}&export=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split("\n")).toHaveLength(4); // header + 3
  });
});
