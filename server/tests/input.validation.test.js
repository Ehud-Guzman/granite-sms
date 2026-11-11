// M1: bad input gets a 4xx with a message, never a 500.
import { describe, it, expect, beforeAll } from "vitest";
import { as, app, request, makeSchool, tokenFor } from "./helpers.js";

let s;
beforeAll(async () => {
  s = await makeSchool();
});

describe("bad input", () => {
  it.each([
    ["/api/fees/invoices?term=BOGUS"],
    ["/api/fees/invoices?status=NOPE"],
    ["/api/fees/invoices?year=abc"],
    ["/api/fees/reports/collections"],
    ["/api/fees/reports/collections?from=2026-13-45&to=2026-01-01"],
  ])("GET %s -> 400", async (url) => {
    const r = await as(s.admin).get(url);
    expect(r.status).toBe(400);
    expect(r.body.message).toBeTruthy();
  });

  it("rejects an invalid term in a request body", async () => {
    const r = await as(s.admin)
      .post("/api/fees/plans")
      .send({ classId: s.klass.id, year: 2026, term: "SUMMER", items: [{ feeItemId: s.feeItem.id, amount: 1 }] });
    expect(r.status).toBe(400);
  });

  it("answers 413 for an oversized body", async () => {
    const r = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${tokenFor(s.admin)}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ x: "a".repeat(1_200_000) }));
    expect(r.status).toBe(413);
  });

  it("answers 400 for malformed JSON", async () => {
    const r = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${tokenFor(s.admin)}`)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(r.status).toBe(400);
  });
});
