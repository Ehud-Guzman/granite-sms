// The figures behind the dashboards and reports.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
  await prisma.schoolSettings.update({ where: { schoolId: s.school.id }, data: { currentTerm: "TERM1", currentAcademicYear: "2026" } });
});

describe("dashboard summary", () => {
  it("gives fee roles the term's collection, a 14-day trend and arrears by class", async () => {
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 5000 });
    const r = await as(s.bursar).get("/api/dashboard/summary");
    r.body = r.body.data;
    expect(r.status).toBe(200);
    expect(r.body.fees.term).toMatchObject({ year: 2026, term: "TERM1", billed: 17000, paid: 5000, balance: 12000, invoices: 1, fullyPaid: 0 });
    expect(r.body.fees.term.percent).toBeCloseTo(29.4, 1);
    expect(r.body.fees.trend).toHaveLength(14);
    expect(r.body.fees.trend.at(-1)).toMatchObject({ amount: 5000, receipts: 1 });
    expect(r.body.fees.byClass).toEqual([expect.objectContaining({ label: "Grade 7 E", balance: 12000 })]);
  });

  it("lists the classes still to mark today, scoped to a teacher's own classes", async () => {
    const admin = (await as(s.admin).get("/api/dashboard/summary")).body.data.attendanceToday;
    expect(admin.classes).toBe(2);
    expect(admin.notMarked.map((c) => c.label).sort()).toEqual(["Grade 7 E", "Grade 8 E"]);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
    const open = await as(s.teacher).post("/api/attendance/sessions").send({ classId: s.klass.id, date: today, year: Number(today.slice(0, 4)), term: "TERM1" });
    const id = open.body.session.id;
    await as(s.teacher)
      .put(`/api/attendance/sessions/${id}/records`)
      .send({ records: s.students.map((st, i) => ({ studentId: st.id, status: i === 2 ? "ABSENT" : "PRESENT" })) });
    await as(s.teacher).post(`/api/attendance/sessions/${id}/submit`).send({});

    const teacher = (await as(s.teacher).get("/api/dashboard/summary")).body.data;
    expect(teacher.fees).toBeNull();
    expect(teacher.attendanceToday).toMatchObject({ classes: 1, registersDone: 1, notMarked: [], present: 2, absent: 1, ratePct: 67 });
    const after = (await as(s.admin).get("/api/dashboard/summary")).body.data.attendanceToday;
    expect(after.notMarked.map((c) => c.label)).toEqual(["Grade 8 E"]);
  });
});

describe("fee reports for the whole school", () => {
  it("summarises every class when no class is chosen", async () => {
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 17000 });
    const r = await as(s.bursar).get("/api/fees/reports/class-summary?year=2026&term=TERM1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ classId: null, totalBilled: 17000, totalPaid: 17000, totalBalance: 0 });
    expect(r.body.byClass).toEqual([expect.objectContaining({ className: "Grade 7", collectionPct: 100 })]);
    expect((await as(s.bursar).get("/api/fees/reports/class-summary?term=TERM1")).status).toBe(400);
  });

  it("lists defaulters across classes with totals beyond the rows shown", async () => {
    const r = await as(s.bursar).get("/api/fees/reports/defaulters?year=2026&term=TERM1&limit=1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ count: 1, totalCount: 1, totalOutstanding: 17000 });
    expect(r.body.rows[0]).toMatchObject({ className: "Grade 7 E", balance: 17000 });
  });
});

describe("what learners can load", () => {
  it("gets the school's branding and letterhead but not its plan and usage", async () => {
    expect((await as(s.studentUser).get("/api/settings/branding")).status).toBe(200);
    expect((await as(s.studentUser).get("/api/settings/print")).status).toBe(200);
    expect((await as(s.studentUser).get("/api/settings/subscription/overview")).status).toBe(403);
    expect((await as(s.admin).get("/api/settings/subscription/overview")).status).toBe(200);
  });
});
