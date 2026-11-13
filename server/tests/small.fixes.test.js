// M14 (audit IP can't be faked) and M10 (school suspension applies at once).
import { describe, it, expect } from "vitest";
import { as, app, request, prisma, makeSchool, makeSystemAdmin } from "./helpers.js";

describe("audit log IP (M14)", () => {
  it("records the address our proxy saw, not one the caller made up", async () => {
    const email = `nobody-${Date.now()}@test.invalid`;
    await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "6.6.6.6, 10.20.30.40") // first entry forged by the caller
      .send({ email, password: "x" });
    const row = await prisma.auditLog.findFirst({ where: { actorEmail: email }, orderBy: { createdAt: "desc" } });
    expect(row.ip).toBe("10.20.30.40");
  });
});

describe("school suspension (M10)", () => {
  it("blocks a platform owner's selected school on the very next request", async () => {
    const s = await makeSchool();
    const sys = await makeSystemAdmin();
    const ok = await as(sys).get("/api/dashboard/summary").set("x-school-id", s.school.id);
    expect(ok.status).toBe(200); // warms the school cache

    await as(sys).patch(`/api/schools/${s.school.id}/status`).send({ isActive: false });
    const blocked = await as(sys).get("/api/dashboard/summary").set("x-school-id", s.school.id);
    expect(blocked.status).toBe(403);
  });
});
