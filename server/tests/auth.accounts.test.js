// C4 (admin takeover), H1 (forced password change), H2 (session revocation).
import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { as, app, request, prisma, makeSchool, TEST_PASSWORD } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });
const reload = (u) => prisma.user.findUnique({ where: { id: u.id } });

describe("admins cannot take over other admins (C4)", () => {
  it("blocks changing another admin's email, status or password", async () => {
    const patch = await as(s.admin).patch(`/api/users/${s.admin2.id}`).send({ email: "evil@test.invalid" });
    const status = await as(s.admin).post(`/api/users/${s.admin2.id}/status`).send({ isActive: false });
    const reset = await as(s.admin).post(`/api/users/${s.admin2.id}/reset-password`).send({});
    for (const r of [patch, status, reset]) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("ADMIN_TARGET_FORBIDDEN");
    }
    const after = await reload(s.admin2);
    expect(after.email).toBe(s.admin2.email);
    expect(after.isActive).toBe(true);
  });

  it("still lets an admin manage teachers", async () => {
    const res = await as(s.admin).post(`/api/users/${s.teacher.id}/reset-password`).send({});
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).toMatch(/.{16}/);
  });

  it("never uses a password chosen by the person resetting", async () => {
    const res = await as(s.admin)
      .post(`/api/users/${s.teacher.id}/reset-password`)
      .send({ password: "Chosen123" });
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).not.toBe("Chosen123");
    expect((await login(s.teacher.email, "Chosen123")).status).toBe(401);
  });
});

describe("forced password change is enforced by the server (H1)", () => {
  beforeEach(async () => {
    await prisma.user.update({ where: { id: s.teacher.id }, data: { mustChangePassword: true } });
  });

  it("blocks normal API use", async () => {
    const res = await as(s.teacher).get("/api/students");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("still allows /api/me (so the app can redirect) and changing the password", async () => {
    const me = await as(s.teacher).get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const change = await as(s.teacher)
      .post("/api/auth/change-password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: "NewPassw0rd!" });
    expect(change.status).toBe(200);

    const relog = await login(s.teacher.email, "NewPassw0rd!");
    expect(relog.status).toBe(200);
    const fresh = await request(app).get("/api/students").set("Authorization", `Bearer ${relog.body.token}`);
    expect(fresh.status).toBe(200);
  });
});

describe("sessions can be ended (H2)", () => {
  it("a password reset signs the user out everywhere, immediately", async () => {
    expect((await as(s.teacher).get("/api/students")).status).toBe(200); // warms the cache
    await as(s.admin).post(`/api/users/${s.teacher.id}/reset-password`).send({});
    const res = await as(s.teacher).get("/api/students");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("deactivating a user ends their session immediately", async () => {
    expect((await as(s.bursar).get("/api/fees/invoices")).status).toBe(200);
    await as(s.admin).post(`/api/users/${s.bursar.id}/status`).send({ isActive: false });
    expect((await as(s.bursar).get("/api/fees/invoices")).status).toBe(401);
  });

  it("changing your password ends your other sessions", async () => {
    const before = await login(s.bursar.email, TEST_PASSWORD);
    const oldToken = before.body.token;
    await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${oldToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "Another1Pass" });
    const res = await request(app).get("/api/fees/invoices").set("Authorization", `Bearer ${oldToken}`);
    expect(res.status).toBe(401);
  });

  it("accepts tokens issued before session versions existed (no tv claim)", async () => {
    const legacy = jwt.sign({ sub: s.admin.id, role: "ADMIN", schoolId: s.school.id }, process.env.JWT_SECRET, {
      issuer: "sms-api",
      audience: "sms-client",
      expiresIn: "1h",
    });
    const res = await request(app).get("/api/students").set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(200);
  });

  it("issues tokens that last 12 hours by default", async () => {
    const res = await login(s.admin.email, TEST_PASSWORD);
    const { iat, exp } = jwt.decode(res.body.token);
    expect(exp - iat).toBe(12 * 60 * 60);
  });
});
