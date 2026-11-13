// H5 (reversal approval), H7 (invoice must match its plan), H6 (teacher dashboard).
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool, paymentsTotal } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

async function postPayment(amount = 5000) {
  const r = await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount, method: "CASH" });
  expect(r.status).toBe(201);
  return r.body.payment;
}

describe("reversals need an admin (H5)", () => {
  it("a bursar cannot reverse directly", async () => {
    const p = await postPayment();
    const r = await as(s.bursar).post(`/api/fees/payments/${p.id}/reverse`).send({ reason: "x" });
    expect(r.status).toBe(403);
    expect(await paymentsTotal(s.invoice.id)).toBe(5000);
  });

  it("a bursar request waits, and an admin approval reverses the payment", async () => {
    const p = await postPayment();
    const req = await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "Wrong student" });
    expect(req.status).toBe(201);
    expect(await paymentsTotal(s.invoice.id)).toBe(5000); // nothing reversed yet

    const pending = await as(s.admin).get("/api/fees/reversal-requests");
    expect(pending.body.requests.map((x) => x.id)).toContain(req.body.request.id);

    const ok = await as(s.admin).post(`/api/fees/reversal-requests/${req.body.request.id}/approve`).send({});
    expect(ok.status).toBe(200);
    expect(await paymentsTotal(s.invoice.id)).toBe(0);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv).toMatchObject({ paid: 0, balance: 17000 });
    const stored = await prisma.feeReversalRequest.findUnique({ where: { id: req.body.request.id } });
    expect(stored).toMatchObject({ status: "APPROVED", decidedBy: s.admin.id });
  });

  it("a rejection needs a reason and leaves the payment in place", async () => {
    const p = await postPayment();
    const req = await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "Oops" });
    const id = req.body.request.id;
    expect((await as(s.admin).post(`/api/fees/reversal-requests/${id}/reject`).send({})).status).toBe(400);
    expect((await as(s.admin).post(`/api/fees/reversal-requests/${id}/reject`).send({ note: "Receipt is correct" })).status).toBe(200);
    expect(await paymentsTotal(s.invoice.id)).toBe(5000);
  });

  it("a bursar cannot approve, and cannot open two requests for one payment", async () => {
    const p = await postPayment();
    const req = await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "a" });
    expect((await as(s.bursar).post(`/api/fees/reversal-requests/${req.body.request.id}/approve`).send({})).status).toBe(403);
    expect((await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "b" })).status).toBe(409);
  });

  it("two admins approving at once reverse the payment only once", async () => {
    const p = await postPayment();
    await postPayment(2000);
    const req = await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "dup" });
    const id = req.body.request.id;
    const [a, b] = await Promise.all([
      as(s.admin).post(`/api/fees/reversal-requests/${id}/approve`).send({}),
      as(s.admin2).post(`/api/fees/reversal-requests/${id}/approve`).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await paymentsTotal(s.invoice.id)).toBe(2000);
  });

  it("another school cannot see or decide this school's requests", async () => {
    const p = await postPayment();
    const req = await as(s.bursar).post(`/api/fees/payments/${p.id}/reversal-requests`).send({ reason: "a" });
    const other = await makeSchool();
    const list = await as(other.admin).get("/api/fees/reversal-requests");
    expect(list.body.requests).toHaveLength(0);
    expect((await as(other.admin).post(`/api/fees/reversal-requests/${req.body.request.id}/approve`).send({})).status).toBe(404);
  });
});

describe("invoices must match their fee plan (H7)", () => {
  const gen = (body) => as(s.admin).post("/api/fees/invoices/generate").send(body);

  it("accepts a matching student, class, year and term", async () => {
    const r = await gen({ studentId: s.students[1].id, classId: s.klass.id, year: 2026, term: "TERM1", feePlanId: s.plan.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ classId: s.klass.id, year: 2026, term: "TERM1", total: 17000 });
  });

  it("rejects another class's plan, a different year or term, and an inactive plan", async () => {
    const outsider = await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: "OUT-1", firstName: "Out", lastName: "Sider", classId: s.otherClass.id },
    });
    const cases = [
      { studentId: outsider.id, classId: s.otherClass.id, year: 2026, term: "TERM1" },
      { studentId: s.students[1].id, classId: s.klass.id, year: 2029, term: "TERM1" },
      { studentId: s.students[1].id, classId: s.klass.id, year: 2026, term: "TERM3" },
      { studentId: outsider.id, classId: s.klass.id, year: 2026, term: "TERM1" }, // student not in plan's class
    ];
    for (const c of cases) {
      const r = await gen({ ...c, feePlanId: s.plan.id });
      expect(r.status, JSON.stringify(c)).toBe(400);
    }
    await prisma.feePlan.update({ where: { id: s.plan.id }, data: { isActive: false } });
    const r = await gen({ studentId: s.students[1].id, classId: s.klass.id, year: 2026, term: "TERM1", feePlanId: s.plan.id });
    expect(r.status).toBe(400);
  });

  it("bulk generation also checks the plan", async () => {
    const r = await as(s.admin)
      .post("/api/fees/invoices/generate-bulk")
      .send({ classId: s.otherClass.id, year: 2026, term: "TERM1", feePlanId: s.plan.id });
    expect(r.status).toBe(400);
  });
});

describe("dashboard fee figures (H6)", () => {
  it("are hidden from teachers and shown to admins and bursars", async () => {
    const t = await as(s.teacher).get("/api/dashboard/summary");
    expect(t.status).toBe(200);
    expect(t.body.data.fees).toBeNull();
    expect(t.body.data.alerts.feesOutstandingTotal).toBeUndefined();

    for (const u of [s.admin, s.bursar]) {
      const r = await as(u).get("/api/dashboard/summary");
      expect(r.body.data.fees.outstandingTotal).toBe(17000);
    }
  });
});
