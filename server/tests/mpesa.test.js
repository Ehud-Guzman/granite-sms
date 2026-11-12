// Missing feature 3: M-Pesa paybill payments, unmatched queue, STK push.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { as, app, request, prisma, makeSchool } from "./helpers.js";

process.env.MPESA_ENC_KEY = crypto.randomBytes(32).toString("base64");
process.env.PUBLIC_API_URL = "https://api.test.invalid";

let s, cfg;
const SHORTCODE = "600123";

async function setUp() {
  const r = await as(s.admin)
    .put("/api/mpesa/config")
    .send({ shortcode: SHORTCODE, kind: "PAYBILL", environment: "sandbox", consumerKey: "ck", consumerSecret: "cs", passkey: "pk" });
  expect(r.status).toBe(200);
  cfg = await prisma.mpesaConfig.findUnique({ where: { schoolId: s.school.id } });
}

const confirm = (body, token = cfg.callbackToken) =>
  request(app).post(`/api/public/mpesa/${token}/c2b/confirmation`).send({ BusinessShortCode: SHORTCODE, TransTime: "20261112083045", ...body });

beforeEach(async () => {
  s = await makeSchool();
  await setUp();
});
afterEach(() => vi.unstubAllGlobals());

describe("m-pesa set-up", () => {
  it("stores credentials encrypted and never returns them", async () => {
    const r = await as(s.admin).get("/api/mpesa/config");
    expect(r.body.config).toMatchObject({ shortcode: SHORTCODE, hasConsumerKey: true, hasPasskey: true });
    expect(JSON.stringify(r.body)).not.toMatch(/"ck"|"cs"|"pk"/);
    expect(cfg.consumerKeyEnc).toMatch(/^v1:/);
    expect(r.body.callbackUrls.confirmation).toBe(`https://api.test.invalid/api/public/mpesa/${cfg.callbackToken}/c2b/confirmation`);
    expect((await as(s.bursar).get("/api/mpesa/config")).status).toBe(403);
  });
});

describe("paybill payments", () => {
  it("matches the account number to the admission number and pays the invoice", async () => {
    const r = await confirm({ TransID: "SGK1AAA111", TransAmount: "5000.00", BillRefNumber: "adm 1", MSISDN: "254712000001", FirstName: "MARY" });
    expect(r.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    const t = await prisma.mpesaTransaction.findUnique({ where: { transId: "SGK1AAA111" } });
    expect(t).toMatchObject({ status: "MATCHED", studentId: s.students[0].id, amount: 5000 });
    expect(await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } })).toMatchObject({ paid: 5000, balance: 12000 });
    const p = await prisma.feePayment.findUnique({ where: { id: t.paymentId } });
    expect(p).toMatchObject({ method: "MPESA", reference: "SGK1AAA111" });
    expect(p.receivedAt.toISOString()).toBe("2026-11-12T05:30:45.000Z"); // 08:30:45 Nairobi
  });

  it("ignores repeats of the same receipt, even at the same moment", async () => {
    const body = { TransID: "SGK1DUP000", TransAmount: "3000", BillRefNumber: "ADM-1" };
    await Promise.all([confirm(body), confirm(body), confirm(body)]);
    await confirm(body);
    expect(await prisma.feePayment.count({ where: { reference: "SGK1DUP000" } })).toBe(1);
    expect(await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } })).toMatchObject({ paid: 3000 });
  });

  it("keeps an unknown account number for the bursar to assign", async () => {
    await confirm({ TransID: "SGK1UNK000", TransAmount: "2000", BillRefNumber: "AMANI FEES" });
    const list = await as(s.bursar).get("/api/mpesa/transactions?status=UNMATCHED");
    expect(list.body.items.map((x) => x.transId)).toEqual(["SGK1UNK000"]);
    const id = list.body.items[0].id;
    const a = await as(s.bursar).post(`/api/mpesa/transactions/${id}/assign`).send({ studentId: s.students[0].id });
    expect(a.status).toBe(200);
    expect(await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } })).toMatchObject({ paid: 2000 });
    expect((await as(s.bursar).post(`/api/mpesa/transactions/${id}/assign`).send({ studentId: s.students[0].id })).status).toBe(409);
  });

  it("refuses unknown tokens and ignores another paybill's number", async () => {
    expect((await confirm({ TransID: "X1", TransAmount: "1", BillRefNumber: "ADM-1" }, "not-a-real-token")).status).toBe(404);
    await confirm({ TransID: "SGK1OTHER0", TransAmount: "100", BillRefNumber: "ADM-1", BusinessShortCode: "999999" });
    expect(await prisma.mpesaTransaction.count({ where: { transId: "SGK1OTHER0" } })).toBe(0);
  });

  it("another school's admin can't see or assign these payments", async () => {
    await confirm({ TransID: "SGK1PRIV00", TransAmount: "2000", BillRefNumber: "nobody" });
    const other = await makeSchool();
    expect((await as(other.admin).get("/api/mpesa/transactions")).body.items).toHaveLength(0);
    const t = await prisma.mpesaTransaction.findUnique({ where: { transId: "SGK1PRIV00" } });
    expect((await as(other.admin).post(`/api/mpesa/transactions/${t.id}/assign`).send({ studentId: other.students[0].id })).status).toBe(404);
  });
});

describe("payment prompt (STK push)", () => {
  it("sends the prompt, then records the payment when Safaricom confirms", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).includes("/oauth/")) return new Response(JSON.stringify({ access_token: "tok", expires_in: "3599" }), { status: 200 });
      return new Response(JSON.stringify({ CheckoutRequestID: "ws_CO_123", CustomerMessage: "Success. Request accepted" }), { status: 200 });
    });
    await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: "+254712000001", students: { create: { schoolId: s.school.id, studentId: s.students[0].id, relationship: "MOTHER", isPrimary: true } } } });

    const r = await as(s.bursar).post("/api/mpesa/stk").send({ studentId: s.students[0].id, amount: 4000 });
    expect(r.status).toBe(200);
    const push = calls.find((c) => c.url.includes("stkpush"));
    expect(push.body).toMatchObject({ BusinessShortCode: SHORTCODE, Amount: 4000, PartyA: "254712000001", AccountReference: "ADM-1" });
    expect(push.body.CallBackURL).toBe(`https://api.test.invalid/api/public/mpesa/${cfg.callbackToken}/stk`);

    await request(app)
      .post(`/api/public/mpesa/${cfg.callbackToken}/stk`)
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: "ws_CO_123",
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: { Item: [{ Name: "Amount", Value: 4000 }, { Name: "MpesaReceiptNumber", Value: "SGK1STK000" }, { Name: "TransactionDate", Value: 20261112090000 }, { Name: "PhoneNumber", Value: 254712000001 }] },
          },
        },
      });
    expect(await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } })).toMatchObject({ paid: 4000 });
    expect((await prisma.mpesaStkRequest.findUnique({ where: { checkoutRequestId: "ws_CO_123" } })).status).toBe("PAID");
  });
});
