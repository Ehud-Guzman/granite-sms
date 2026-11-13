// H3 (school-wide rate limits) and H4 (lockout abuse, enumeration).
import { describe, it, expect, beforeEach } from "vitest";
import { app, request, prisma, makeSchool, TEST_PASSWORD } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

// Each test uses its own fake client IP so the per-network limiters of one
// test don't spill into another (app trusts one proxy hop).
let ipSeq = 0;
const freshIp = () => `10.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}.${Math.floor(Math.random() * 250) + 1}`;
const login = (email, password, ip) =>
  request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email, password });

describe("sign-in lockout (H4)", () => {
  it("unlocks cleanly: one mistake after a lock expires does not lock again", async () => {
    await prisma.user.update({
      where: { id: s.teacher.id },
      data: { failedLoginAttempts: 10, lockUntil: new Date(Date.now() - 60_000) },
    });
    await login(s.teacher.email, "wrong", freshIp());
    const u = await prisma.user.findUnique({ where: { id: s.teacher.id } });
    expect(u.failedLoginAttempts).toBe(1);
    expect(u.lockUntil).toBeNull();
    expect((await login(s.teacher.email, TEST_PASSWORD, freshIp())).status).toBe(200);
  });

  it("gives the same answer for unknown, wrong-password and locked accounts", async () => {
    await prisma.user.update({
      where: { id: s.bursar.id },
      data: { failedLoginAttempts: 10, lockUntil: new Date(Date.now() + 600_000) },
    });
    const unknown = await login("nobody@test.invalid", "x", freshIp());
    const wrong = await login(s.teacher.email, "x", freshIp());
    const locked = await login(s.bursar.email, TEST_PASSWORD, freshIp());
    for (const r of [unknown, wrong, locked]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(unknown.body);
    }
  });
});

describe("rate limits suit a school on one connection (H3)", () => {
  it("lets 40 colleagues on the same IP sign in", async () => {
    const ip = freshIp();
    const users = [s.admin, s.bursar, s.teacher, s.teacher2];
    const results = [];
    for (let i = 0; i < 40; i++) {
      const u = users[i % users.length];
      results.push((await login(u.email, TEST_PASSWORD, ip)).status);
    }
    expect(results.every((st) => st === 200)).toBe(true);
  });

  it("stops repeated guessing at one account from one network", async () => {
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(s.teacher2.email, `guess${i}`, ip)).status);
    expect(statuses.slice(0, 10).every((st) => st === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("guessing from another network does not block the real user's network", async () => {
    const attacker = freshIp();
    for (let i = 0; i < 11; i++) await login(s.admin.email, `guess${i}`, attacker);
    // Account lock (10 failures) is the backstop; clear it to isolate the limiter.
    await prisma.user.update({ where: { id: s.admin.id }, data: { failedLoginAttempts: 0, lockUntil: null } });
    expect((await login(s.admin.email, TEST_PASSWORD, freshIp())).status).toBe(200);
  });
});
