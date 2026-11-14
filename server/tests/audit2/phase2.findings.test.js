// Audit 2, Phase 2: each test states the SAFE behaviour for one finding.
// While a finding is open its test fails; that failure is the evidence.
// Once fixed, drop the AUDIT2_SWEEP gate so it guards against regressions.
//
//   AUDIT2_SWEEP=1 TEST_DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:55433/granite_audit2_test \
//     npx vitest run tests/audit2/phase2.findings.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { as, app, request, prisma, makeSchool, makeSystemAdmin } from "../helpers.js";

const suite = describe.runIf(process.env.AUDIT2_SWEEP === "1");
const newPhone = () => `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

let s;
beforeEach(async () => {
  if (process.env.AUDIT2_SWEEP !== "1") return;
  s = await makeSchool();
});

suite("A2-SEC: parent temporary passwords", () => {
  it("are not readable from the SMS log by a bursar", async () => {
    process.env.SMS_PROVIDER = "memory";
    expect((await as(s.admin).patch("/api/sms/settings").send({ smsEnabled: true })).status).toBe(200);
    const mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mum", lastName: "Test", phone: newPhone() } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[0].id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });

    const created = await as(s.admin).post(`/api/guardians/${mum.id}/login`).send({ sendSms: true });
    expect(created.status).toBe(201);
    const temp = created.body.tempPassword;

    const log = await as(s.bursar).get("/api/sms/messages");
    expect(log.status).toBe(200);
    // SAFE: the stored/listed message must not contain the password.
    expect(JSON.stringify(log.body)).not.toContain(temp);

    // And what it allows today: the bursar signs in as the parent.
    const login = await request(app).post("/api/auth/login").send({ email: mum.phone, password: temp });
    expect(login.status).not.toBe(200);
  });
});

suite("A2-SEC: impersonation", () => {
  it("cannot impersonate another platform owner", async () => {
    const prev = process.env.ALLOW_IMPERSONATION;
    process.env.ALLOW_IMPERSONATION = "true";
    try {
      const a = await makeSystemAdmin();
      const b = await makeSystemAdmin();
      const res = await as(a).post("/api/auth/impersonate").send({ userId: b.id });
      expect(res.status).toBe(403);
    } finally {
      process.env.ALLOW_IMPERSONATION = prev;
    }
  });

  it("gives a short-lived token, not a full 12-hour one", async () => {
    const prev = process.env.ALLOW_IMPERSONATION;
    process.env.ALLOW_IMPERSONATION = "true";
    try {
      const a = await makeSystemAdmin();
      const res = await as(a).post("/api/auth/impersonate").send({ userId: s.admin.id });
      expect(res.status).toBe(200);
      const claims = JSON.parse(Buffer.from(res.body.token.split(".")[1], "base64url").toString());
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(60 * 60);
    } finally {
      process.env.ALLOW_IMPERSONATION = prev;
    }
  });
});

suite("A2-OPS: SMS outbox with two server instances", () => {
  it("sends each queued message once, even when two instances flush at the same moment", async () => {
    process.env.SMS_PROVIDER = "memory";
    // Two copies of the module = two server processes, each with its own in-process guard.
    const one = await import("../../src/modules/sms/sms.js?instance=1");
    const two = await import("../../src/modules/sms/sms.js?instance=2");
    const body = `audit2-double-send-${Date.now()}`;
    await prisma.smsMessage.create({ data: { schoolId: s.school.id, to: newPhone(), body, kind: "BROADCAST", status: "QUEUED" } });
    expect(one).not.toBe(two); // really two module instances
    const queuedBefore = await prisma.smsMessage.count({ where: { OR: [{ status: "QUEUED" }, { status: "FAILED", attempts: { lt: 3 } }] } });
    expect(queuedBefore).toBeLessThan(200); // ours is inside one flush batch
    await Promise.all([one.flushOutbox(), two.flushOutbox()]);
    const sends = [...one.sentForTests, ...two.sentForTests].filter((m) => m.body === body).length;
    expect(sends).toBe(1);
  });
});
