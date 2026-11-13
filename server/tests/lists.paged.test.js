// The payments ledger, M-Pesa history, noticeboard and attendance registers
// come back a page at a time (or with their counts), filtered on the server.
import { describe, it, expect, beforeAll } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { localDateString } from "../src/utils/schoolTime.js";

let s;
const today = () => localDateString(new Date(), "Africa/Nairobi");

beforeAll(async () => {
  s = await makeSchool();
  const pay = (body) => as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, ...body });
  for (let i = 0; i < 6; i++) await pay({ amount: 1000, method: "CASH" });
  await pay({ amount: 2500, method: "MPESA", reference: "SGK3ABC123" });
  // One from last year, outside a date filter.
  await prisma.feePayment.create({
    data: { schoolId: s.school.id, studentId: s.students[0].id, amount: 700, method: "BANK", receivedAt: new Date("2025-03-02T08:00:00Z"), receiptNo: `OLD-${s.school.id}` },
  });
});

describe("payments ledger", () => {
  it("pages newest first with totals for the whole filter", async () => {
    const r = await as(s.bursar).get("/api/fees/payments?page=1&pageSize=5");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 8, page: 1, pageSize: 5 });
    expect(r.body.items).toHaveLength(5);
    expect(r.body.items[0].student).toHaveProperty("admissionNo");
    expect(r.body.totals.amount).toBe(6000 + 2500 + 700);
    expect(r.body.totals.byMethod[0]).toMatchObject({ method: "CASH", amount: 6000, count: 6 });
    // The chart series covers the same money: by month here (2025 to now).
    expect(r.body.totals.bucket).toBe("month");
    expect(r.body.totals.series.reduce((n, x) => n + x.amount, 0)).toBe(r.body.totals.amount);
    const today = await as(s.bursar).get(`/api/fees/payments?from=${localDateString(new Date(), "Africa/Nairobi")}`);
    expect(today.body.totals).toMatchObject({ bucket: "day", series: [{ amount: 8500 }] });
  });

  it("filters by day, method and search", async () => {
    const d = today();
    expect((await as(s.bursar).get(`/api/fees/payments?from=${d}&to=${d}`)).body.total).toBe(7);
    expect((await as(s.bursar).get("/api/fees/payments?method=MPESA")).body.totals.amount).toBe(2500);
    expect((await as(s.bursar).get("/api/fees/payments?q=sgk3abc")).body.total).toBe(1);
    expect((await as(s.bursar).get(`/api/fees/payments?q=${s.students[0].admissionNo}`)).body.total).toBe(8);
  });

  it("refuses bad filters and other roles", async () => {
    expect((await as(s.bursar).get("/api/fees/payments?method=GOLD")).status).toBe(400);
    expect((await as(s.bursar).get("/api/fees/payments?from=13-11-2026")).status).toBe(400);
    expect((await as(s.teacher).get("/api/fees/payments")).status).toBe(403);
  });
});

describe("M-Pesa history", () => {
  it("pages and counts each state", async () => {
    for (let i = 0; i < 4; i++) {
      await prisma.mpesaTransaction.create({
        data: { schoolId: s.school.id, transId: `T${i}-${s.school.id}`.slice(0, 40), amount: 100, status: i === 0 ? "UNMATCHED" : "MATCHED" },
      });
    }
    const r = await as(s.bursar).get("/api/mpesa/transactions?page=1&pageSize=2&status=MATCHED");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 3, page: 1, pageSize: 2, counts: { MATCHED: 3, UNMATCHED: 1 } });
    expect(r.body.items).toHaveLength(2);
    // The old form still works.
    expect((await as(s.bursar).get("/api/mpesa/transactions")).body.items).toHaveLength(4);
  });
});

describe("noticeboard", () => {
  it("pages pinned first and searches", async () => {
    for (let i = 0; i < 12; i++) {
      await as(s.admin).post("/api/notices").send({ title: `Notice ${i}`, body: i === 3 ? "Bring your swimming kit." : "Details.", pinned: i === 0 });
    }
    const p1 = await as(s.teacher).get("/api/notices?page=1&pageSize=5");
    expect(p1.body).toMatchObject({ total: 12, page: 1, pageSize: 5 });
    expect(p1.body.notices[0]).toMatchObject({ title: "Notice 0", pinned: true });
    const p3 = await as(s.teacher).get("/api/notices?page=3&pageSize=5");
    expect(p3.body.notices).toHaveLength(2);
    const found = await as(s.studentUser).get("/api/notices?page=1&q=swimming");
    expect(found.body.notices.map((n) => n.title)).toEqual(["Notice 3"]);
  });
});

describe("attendance registers", () => {
  it("come with the class and how many were present", async () => {
    const open = await as(s.teacher).post("/api/attendance/sessions").send({ classId: s.klass.id, date: today(), year: Number(today().slice(0, 4)), term: "TERM1" });
    expect(open.status).toBe(200);
    const recs = await prisma.attendanceRecord.findMany({ where: { sessionId: open.body.session.id } });
    await prisma.attendanceRecord.update({ where: { id: recs[0].id }, data: { status: "PRESENT" } });
    if (recs[1]) await prisma.attendanceRecord.update({ where: { id: recs[1].id }, data: { status: "ABSENT" } });

    const r = await as(s.teacher).get(`/api/attendance/sessions?from=${today()}&to=${today()}`);
    expect(r.status).toBe(200);
    const reg = r.body.find((x) => x.id === open.body.session.id);
    expect(reg.class).toMatchObject({ name: "Grade 7" });
    expect(reg.counts.total).toBe(recs.length);
    expect(reg.counts.PRESENT).toBe(1);
  });
});
