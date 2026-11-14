// Audit 2 fixes (docs/audit-2/AUDIT_REPORT_2.md): each test states the safe behaviour.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { as, prisma, makeSchool, makeSystemAdmin } from "./helpers.js";

process.env.MPESA_ENC_KEY ||= crypto.randomBytes(32).toString("base64");
process.env.PUBLIC_API_URL ||= "https://api.test.invalid";

const newPhone = () => `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
let s;
beforeEach(async () => {
  s = await makeSchool();
});
afterEach(() => vi.unstubAllGlobals());

const addParent = async (phone, studentId = s.students[0].id) =>
  prisma.guardian.create({
    data: { schoolId: s.school.id, firstName: "Mum", lastName: "Test", phone, students: { create: { schoolId: s.school.id, studentId, relationship: "MOTHER", isPrimary: true } } },
  });

describe("A2-SEC-04: parent temporary passwords", () => {
  it("are texted, but never kept in the SMS log staff can read", async () => {
    process.env.SMS_PROVIDER = "memory";
    expect((await as(s.admin).patch("/api/sms/settings").send({ smsEnabled: true })).status).toBe(200);
    const mum = await addParent(newPhone());
    const created = await as(s.admin).post(`/api/guardians/${mum.id}/login`).send({ sendSms: true });
    expect(created.status).toBe(201);
    expect(created.body.smsQueued).toBe(true);
    const temp = created.body.tempPassword;

    const { sentForTests } = await import("../src/modules/sms/sms.js");
    expect(sentForTests.some((m) => m.body.includes(temp))).toBe(true); // the parent got it
    const log = await as(s.bursar).get("/api/sms/messages");
    expect(log.status).toBe(200);
    expect(JSON.stringify(log.body)).not.toContain(temp);
    expect(JSON.stringify(log.body)).toContain("••••••");
  });
});

describe("A2-SEC-05/06: impersonation", () => {
  let prev;
  beforeEach(() => {
    prev = process.env.ALLOW_IMPERSONATION;
    process.env.ALLOW_IMPERSONATION = "true";
  });
  afterEach(() => {
    process.env.ALLOW_IMPERSONATION = prev;
  });

  it("can't target another platform owner", async () => {
    const a = await makeSystemAdmin();
    const b = await makeSystemAdmin();
    expect((await as(a).post("/api/auth/impersonate").send({ userId: b.id })).status).toBe(403);
  });

  it("gives a one-hour token", async () => {
    const a = await makeSystemAdmin();
    const res = await as(a).post("/api/auth/impersonate").send({ userId: s.admin.id });
    expect(res.status).toBe(200);
    const claims = JSON.parse(Buffer.from(res.body.token.split(".")[1], "base64url").toString());
    expect(claims.exp - claims.iat).toBe(60 * 60);
    expect(claims.imp).toBeTruthy();
  });
});

describe("A2-OPS-01: SMS outbox with two server instances", () => {
  it("sends each queued message once when two instances flush at the same moment", async () => {
    process.env.SMS_PROVIDER = "memory";
    // Two copies of the module behave like two server processes.
    const one = await import("../src/modules/sms/sms.js?instance=1");
    const two = await import("../src/modules/sms/sms.js?instance=2");
    expect(one).not.toBe(two);
    const body = `double-send-check-${crypto.randomBytes(4).toString("hex")}`;
    await prisma.smsMessage.create({ data: { schoolId: s.school.id, to: newPhone(), body, kind: "BROADCAST", status: "QUEUED", createdAt: new Date(0) } });
    await Promise.all([one.flushOutbox(), two.flushOutbox()]);
    const sends = [...one.sentForTests, ...two.sentForTests].filter((m) => m.body === body).length;
    expect(sends).toBe(1);
    const row = await prisma.smsMessage.findFirst({ where: { body } });
    expect(row).toMatchObject({ status: "SENT", attempts: 1 });
  });
});

describe("A2-SEC-07: M-Pesa payment prompts", () => {
  let n = 0;
  beforeEach(async () => {
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("/oauth/")) return new Response(JSON.stringify({ access_token: "tok", expires_in: "3599" }), { status: 200 });
      return new Response(JSON.stringify({ CheckoutRequestID: `ws_CO_${crypto.randomBytes(6).toString("hex")}_${n++}`, CustomerMessage: "ok" }), { status: 200 });
    });
    const r = await as(s.admin).put("/api/mpesa/config").send({ shortcode: "600123", kind: "PAYBILL", environment: "sandbox", consumerKey: "ck", consumerSecret: "cs", passkey: "pk" });
    expect(r.status).toBe(200);
  });

  it("only go to a guardian's number on the learner's record", async () => {
    const mum = newPhone();
    await addParent(mum);
    const stranger = newPhone();
    const bad = await as(s.bursar).post("/api/mpesa/stk").send({ studentId: s.students[0].id, amount: 100, phone: stranger });
    expect(bad.status).toBe(400);
    const ok = await as(s.bursar).post("/api/mpesa/stk").send({ studentId: s.students[0].id, amount: 100, phone: mum });
    expect(ok.status).toBe(200);
  });

  it("stop after 3 prompts to one number in 10 minutes", async () => {
    await addParent(newPhone());
    const send = () => as(s.bursar).post("/api/mpesa/stk").send({ studentId: s.students[0].id, amount: 100 });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});
