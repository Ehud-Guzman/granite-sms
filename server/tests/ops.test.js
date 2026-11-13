// M17: request ids, readiness check, student field validation.
import { describe, it, expect, beforeAll } from "vitest";
import { as, app, request, makeSchool } from "./helpers.js";

let s;
beforeAll(async () => {
  s = await makeSchool();
});

describe("operations", () => {
  it("tags every response with a request id, keeping a sane incoming one", async () => {
    const a = await request(app).get("/health");
    expect(a.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get("/health").set("X-Request-Id", "trace-12345678");
    expect(b.headers["x-request-id"]).toBe("trace-12345678");
    const c = await request(app).get("/health").set("X-Request-Id", "bad id with spaces");
    expect(c.headers["x-request-id"]).not.toBe("bad id with spaces");
  });

  it("reports ready when the database answers", async () => {
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(200);
    expect(r.body.database).toBe("ok");
  });
});

describe("student fields", () => {
  const create = (body) =>
    as(s.admin).post("/api/students").send({ admissionNo: `V-${Math.random()}`.slice(0, 12), firstName: "Val", lastName: "Id", ...body });

  it("normalises gender and rejects nonsense", async () => {
    const ok = await create({ gender: "f" });
    expect(ok.status).toBe(201);
    expect(ok.body.gender).toBe("FEMALE");
    expect((await create({ gender: "banana" })).status).toBe(400);
  });

  it("rejects birth dates in the future or implausibly old", async () => {
    expect((await create({ dob: "2099-01-01" })).status).toBe(400);
    expect((await create({ dob: "1900-01-01" })).status).toBe(400);
    expect((await create({ dob: "2014-05-20" })).status).toBe(201);
  });

  it("checks the same on update", async () => {
    const r = await as(s.admin).patch(`/api/students/${s.students[0].id}`).send({ gender: "unknown" });
    expect(r.status).toBe(400);
  });
});
