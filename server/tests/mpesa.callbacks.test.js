// Audit 2, A2-SEC-03: an M-Pesa callback token must never reach the logs,
// and in production the token alone can't post a payment.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { as, app, request, prisma, makeSchool } from "./helpers.js";
import { redactPath } from "../src/utils/logRedact.js";

process.env.MPESA_ENC_KEY ||= crypto.randomBytes(32).toString("base64");
process.env.PUBLIC_API_URL ||= "https://api.test.invalid";

const SHORTCODE = "600123";
const RUN = crypto.randomBytes(3).toString("hex").toUpperCase();
let s, cfg;
const saved = {};

beforeEach(async () => {
  saved.NODE_ENV = process.env.NODE_ENV;
  saved.MPESA_ALLOWED_IPS = process.env.MPESA_ALLOWED_IPS;
  s = await makeSchool();
  const r = await as(s.admin)
    .put("/api/mpesa/config")
    .send({ shortcode: SHORTCODE, kind: "PAYBILL", environment: "sandbox", consumerKey: "ck", consumerSecret: "cs", passkey: "pk" });
  expect(r.status).toBe(200);
  cfg = await prisma.mpesaConfig.findUnique({ where: { schoolId: s.school.id } });
});
afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  process.env.MPESA_ALLOWED_IPS = saved.MPESA_ALLOWED_IPS;
});

const confirm = (transId) =>
  request(app)
    .post(`/api/public/mpesa/${cfg.callbackToken}/c2b/confirmation`)
    .send({ BusinessShortCode: SHORTCODE, TransTime: "20261112083045", TransID: transId, TransAmount: "5000", BillRefNumber: "ADM-1" });
const recorded = (transId) => prisma.mpesaTransaction.findUnique({ where: { transId } });

describe("request log", () => {
  it("never writes the M-Pesa callback token", () => {
    const p = redactPath("/api/public/mpesa/SECRET-TOKEN-123/c2b/confirmation?x=1");
    expect(p).toBe("/api/public/mpesa/[redacted]/c2b/confirmation");
    expect(p).not.toContain("SECRET");
    expect(redactPath("/api/fees/invoices?page=2")).toBe("/api/fees/invoices");
  });
});

describe("callbacks in production", () => {
  it("are refused, and nothing is posted, when no Safaricom IP allowlist is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.MPESA_ALLOWED_IPS = "";
    const res = await confirm(`FORGED${RUN}`);
    expect(res.status).toBe(503);
    expect(await recorded(`FORGED${RUN}`)).toBeNull();
  });

  it("are refused from an address outside the allowlist", async () => {
    process.env.NODE_ENV = "production";
    process.env.MPESA_ALLOWED_IPS = "196.201.214.200";
    const res = await confirm(`OUTSIDE${RUN}`);
    expect(res.status).toBe(403);
    expect(await recorded(`OUTSIDE${RUN}`)).toBeNull();
  });

  it("are accepted from an allowed address", async () => {
    process.env.NODE_ENV = "production";
    // In-process requests come from loopback; Express reports it as either form.
    process.env.MPESA_ALLOWED_IPS = "::ffff:127.0.0.1,127.0.0.1,::1";
    const res = await confirm(`ALLOWED${RUN}`);
    expect(res.status).toBe(200);
    expect(await recorded(`ALLOWED${RUN}`)).not.toBeNull();
  });
});
