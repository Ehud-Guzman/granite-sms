// C1: payments and reversals must keep the invoice equal to its payment rows,
// even when requests arrive at the same moment.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool, paymentsTotal } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const pay = (user, invoiceId, amount, extra = {}) =>
  as(user).post("/api/fees/payments").send({ invoiceId, amount, method: "MPESA", ...extra });

describe("fee payments", () => {
  it("records a payment and updates the invoice", async () => {
    const res = await pay(s.bursar, s.invoice.id, 5000);
    expect(res.status).toBe(201);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv).toMatchObject({ paid: 5000, balance: 12000, status: "PARTIALLY_PAID" });
  });

  it("keeps an overpayment as credit (it used to be refused)", async () => {
    const res = await pay(s.bursar, s.invoice.id, 17001);
    expect(res.status).toBe(201);
    expect(res.body.invoice).toMatchObject({ paid: 17000, balance: 0, status: "PAID" });
    expect(res.body.account).toEqual({ owed: 0, credit: 1, net: -1 });
  });

  it("keeps the account consistent under concurrent payments", async () => {
    // 5 x 10,000 against a 17,000 invoice: 17,000 pays it, 33,000 is credit.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => pay(s.bursar, s.invoice.id, 10000, { reference: `R${i}` }))
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    const allocated = await prisma.feePaymentAllocation.aggregate({ where: { invoiceId: s.invoice.id }, _sum: { amount: true } });
    expect(inv).toMatchObject({ paid: 17000, balance: 0, status: "PAID" });
    expect(allocated._sum.amount).toBe(17000);
    const last = await as(s.bursar).get(`/api/fees/students/${s.students[0].id}/summary`);
    expect(last.body.account).toEqual({ owed: 0, credit: 33000, net: -33000 });
  });

  it("keeps the invoice consistent when many small payments race", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pay(s.bursar, s.invoice.id, 1000, { reference: `S${i}` }))
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv.paid).toBe(10000);
    expect(inv.paid).toBe(await paymentsTotal(s.invoice.id));
    expect(inv.balance).toBe(7000);
  });

  it("treats a repeated clientTxnId as the same payment", async () => {
    const [a, b] = await Promise.all([
      pay(s.bursar, s.invoice.id, 2000, { clientTxnId: "txn-1" }),
      pay(s.bursar, s.invoice.id, 2000, { clientTxnId: "txn-1" }),
    ]);
    expect([a.status, b.status].every((st) => st === 201 || st === 409)).toBe(true);
    expect(await paymentsTotal(s.invoice.id)).toBe(2000);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv.paid).toBe(2000);
  });

  it("does not let another school pay this invoice", async () => {
    const other = await makeSchool();
    const res = await pay(other.bursar, s.invoice.id, 100);
    expect(res.status).toBe(404);
  });
});

describe("payment reversals", () => {
  it("restores the balance when an admin reverses a payment", async () => {
    const p = await pay(s.bursar, s.invoice.id, 5000);
    const res = await as(s.admin).post(`/api/fees/payments/${p.body.payment.id}/reverse`).send({ reason: "Bounced" });
    expect(res.status).toBe(200);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv).toMatchObject({ paid: 0, balance: 17000, status: "ISSUED" });
  });

  it("only reverses a payment once, even when requests race", async () => {
    const p = await pay(s.bursar, s.invoice.id, 5000);
    await pay(s.bursar, s.invoice.id, 3000);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        as(s.admin).post(`/api/fees/payments/${p.body.payment.id}/reverse`).send({ reason: "Dup" })
      )
    );
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv.paid).toBe(3000);
    expect(inv.paid).toBe(await paymentsTotal(s.invoice.id));
  });

  it("stays consistent when a reversal races a new payment", async () => {
    const p = await pay(s.bursar, s.invoice.id, 5000);
    await Promise.all([
      as(s.admin).post(`/api/fees/payments/${p.body.payment.id}/reverse`).send({ reason: "Wrong student" }),
      pay(s.bursar, s.invoice.id, 4000),
    ]);
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv.paid).toBe(await paymentsTotal(s.invoice.id));
    expect(inv.balance).toBe(17000 - inv.paid);
  });
});
