// M6: sequential, gap-free receipt and invoice numbers; receipts name the cashier.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { localDateString } from "../src/utils/schoolTime.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const pay = (amount) =>
  as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount, method: "CASH" });

describe("receipt numbers", () => {
  it("run 1, 2, 3 … per school and year, even under concurrent payments", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => pay(1000)));
    const year = localDateString(new Date(), "Africa/Nairobi").slice(0, 4);
    const nos = results.map((r) => r.body.payment.receiptNo).sort();
    expect(nos).toEqual(Array.from({ length: 8 }, (_, i) => `RCPT-${year}-${String(i + 1).padStart(6, "0")}`));
  });

  it("a refused payment doesn't use up a number", async () => {
    const year = localDateString(new Date(), "Africa/Nairobi").slice(0, 4);
    expect((await pay(1000)).body.payment.receiptNo).toBe(`RCPT-${year}-000001`);
    expect((await pay(999999)).status).toBe(400); // overpayment, rolled back
    expect((await pay(1000)).body.payment.receiptNo).toBe(`RCPT-${year}-000002`);
  });

  it("each school has its own sequence", async () => {
    const other = await makeSchool();
    await pay(1000);
    const r = await as(other.bursar).post("/api/fees/payments").send({ invoiceId: other.invoice.id, amount: 1000 });
    expect(r.body.payment.receiptNo).toMatch(/-000001$/);
  });

  it("the receipt names the cashier, not their user id", async () => {
    await prisma.teacher.create({ data: { schoolId: s.school.id, userId: s.bursar.id, firstName: "Rose", lastName: "Cashier" } });
    const p = await pay(500);
    const r = await as(s.admin).get(`/api/fees/payments/${p.body.payment.id}/receipt`);
    expect(r.body.payment.receivedByName).toBe("Rose Cashier");
  });
});

describe("invoice numbers", () => {
  it("bulk generation numbers invoices in sequence for the plan's year", async () => {
    const r = await as(s.admin)
      .post("/api/fees/invoices/generate-bulk")
      .send({ classId: s.klass.id, year: 2026, term: "TERM1", feePlanId: s.plan.id });
    expect(r.status).toBe(201);
    expect(r.body.createdCount).toBe(2); // students[0] already has one
    const nos = (
      await prisma.feeInvoice.findMany({ where: { id: { in: r.body.created.map((c) => c.invoiceId) } }, select: { invoiceNo: true } })
    )
      .map((i) => i.invoiceNo)
      .sort();
    expect(nos).toEqual(["INV-2026-000001", "INV-2026-000002"]);
  });
});
