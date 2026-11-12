// M5: the learner's fee account: credit, arrears first, extra charges, voids.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s, term2Plan;
beforeEach(async () => {
  s = await makeSchool();
  term2Plan = await prisma.feePlan.create({
    data: { schoolId: s.school.id, classId: s.klass.id, year: 2026, term: "TERM2", items: { create: [{ feeItemId: s.feeItem.id, amount: 20000 }] } },
  });
});

const learner = () => s.students[0].id;
const account = async () => (await as(s.bursar).get(`/api/fees/students/${learner()}/summary`)).body.account;
const inv = (id) => prisma.feeInvoice.findUnique({ where: { id } });
const genTerm2 = () =>
  as(s.admin).post("/api/fees/invoices/generate").send({ studentId: learner(), classId: s.klass.id, year: 2026, term: "TERM2", feePlanId: term2Plan.id });

describe("fee account", () => {
  it("money paid before the invoice exists waits as credit, then pays it", async () => {
    // Term 1 (17,000) is already invoiced; parent pays 25,000 onto the account.
    const p = await as(s.bursar).post("/api/fees/payments").send({ studentId: learner(), amount: 25000, method: "MPESA" });
    expect(p.status).toBe(201);
    expect(p.body.payment.invoiceId).toBeNull();
    expect(p.body.account).toEqual({ owed: 0, credit: 8000, net: -8000 });
    expect(await inv(s.invoice.id)).toMatchObject({ paid: 17000, status: "PAID" });

    // Term 2 invoice: the 8,000 credit is used straight away.
    const t2 = await genTerm2();
    expect(t2.status).toBe(201);
    expect(t2.body).toMatchObject({ total: 20000, paid: 8000, balance: 12000, status: "PARTIALLY_PAID" });
    expect(await account()).toEqual({ owed: 12000, credit: 0, net: 12000 });
  });

  it("a payment pays the invoice it was taken on, then the oldest unpaid (arrears)", async () => {
    const t2 = (await genTerm2()).body; // Term 1 still owes 17,000
    const p = await as(s.bursar).post("/api/fees/payments").send({ invoiceId: t2.id, amount: 25000 });
    expect(p.body.allocations).toEqual([
      expect.objectContaining({ invoiceId: t2.id, amount: 20000 }),
      expect.objectContaining({ invoiceId: s.invoice.id, amount: 5000 }),
    ]);
    expect(await inv(s.invoice.id)).toMatchObject({ paid: 5000, balance: 12000 });
    const detail = await as(s.bursar).get(`/api/fees/invoices/${t2.id}`);
    expect(detail.body.arrears).toBe(12000);
  });

  it("paying onto the account clears the oldest invoice first", async () => {
    const t2 = (await genTerm2()).body;
    await as(s.bursar).post("/api/fees/payments").send({ studentId: learner(), amount: 20000 });
    expect(await inv(s.invoice.id)).toMatchObject({ paid: 17000, status: "PAID" });
    expect(await inv(t2.id)).toMatchObject({ paid: 3000, balance: 17000 });
  });

  it("reversing a payment takes back exactly what it paid", async () => {
    const t2 = (await genTerm2()).body;
    const p = (await as(s.bursar).post("/api/fees/payments").send({ studentId: learner(), amount: 20000 })).body.payment;
    const r = await as(s.admin).post(`/api/fees/payments/${p.id}/reverse`).send({ reason: "Bounced cheque" });
    expect(r.status).toBe(200);
    expect(await inv(s.invoice.id)).toMatchObject({ paid: 0, balance: 17000 });
    expect(await inv(t2.id)).toMatchObject({ paid: 0, balance: 20000 });
    expect(await account()).toEqual({ owed: 37000, credit: 0, net: 37000 });
  });

  it("voiding an invoice turns its payments into credit for the other invoices", async () => {
    const t2 = (await genTerm2()).body;
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: t2.id, amount: 5000 });
    const v = await as(s.admin).post(`/api/fees/invoices/${t2.id}/void`).send({ reason: "Wrong plan" });
    expect(v.status).toBe(200);
    // The 5,000 now pays Term 1 instead.
    expect(await inv(t2.id)).toMatchObject({ status: "VOID", paid: 0 });
    expect(await inv(s.invoice.id)).toMatchObject({ paid: 5000, balance: 12000 });
  });

  it("adds a charge mid-term, and credit covers it", async () => {
    await as(s.bursar).post("/api/fees/payments").send({ studentId: learner(), amount: 20000 }); // 3,000 credit
    const trip = await prisma.feeItem.create({ data: { schoolId: s.school.id, name: "Trip" } });
    const r = await as(s.admin).post(`/api/fees/invoices/${s.invoice.id}/lines`).send({ feeItemId: trip.id, amount: 2500, note: "Nairobi museum" });
    expect(r.status).toBe(201);
    expect(r.body.invoice).toMatchObject({ total: 19500, paid: 19500, balance: 0 });
    expect(await account()).toEqual({ owed: 0, credit: 500, net: -500 });
    expect((await as(s.bursar).post(`/api/fees/invoices/${s.invoice.id}/lines`).send({ feeItemId: trip.id, amount: 1 })).status).toBe(403);
  });

  it("the statement lists account payments and how each was applied", async () => {
    await as(s.bursar).post("/api/fees/payments").send({ studentId: learner(), amount: 18000 });
    const st = await as(s.bursar).get(`/api/fees/students/${learner()}/statement`);
    const pay = st.body.timeline.find((t) => t.type === "PAYMENT");
    expect(pay).toMatchObject({ amount: 18000, toCredit: 1000 });
    expect(pay.appliedTo).toEqual([{ invoiceNo: s.invoice.invoiceNo, amount: 17000 }]);
    expect(st.body.account).toEqual({ owed: 0, credit: 1000, net: -1000 });
  });

  it("two cashiers paying different invoices of one learner at once stay consistent", async () => {
    const t2 = (await genTerm2()).body;
    await Promise.all([
      as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 20000 }),
      as(s.admin).post("/api/fees/payments").send({ invoiceId: t2.id, amount: 20000 }),
    ]);
    const a = await inv(s.invoice.id);
    const b = await inv(t2.id);
    expect(a.paid + b.paid).toBe(37000);
    expect(await account()).toEqual({ owed: 0, credit: 3000, net: -3000 });
  });
});
