// H10: big lists come back a page at a time, with search and totals.
import { describe, it, expect, beforeAll } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s;
beforeAll(async () => {
  s = await makeSchool();
  // 120 more learners with invoices, one of them void.
  for (let i = 0; i < 120; i++) {
    const st = await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: `P-${String(i).padStart(3, "0")}`, firstName: `Pupil${i}`, lastName: "Paged", classId: s.klass.id },
    });
    await prisma.feeInvoice.create({
      data: {
        schoolId: s.school.id,
        studentId: st.id,
        classId: s.klass.id,
        year: 2026,
        term: "TERM1",
        invoiceNo: `PG-${s.school.id}-${i}`,
        status: i === 0 ? "VOID" : "ISSUED",
        total: 1000,
        balance: i === 0 ? 0 : 1000,
      },
    });
  }
});

describe("invoice list", () => {
  it("returns one light page plus totals for the whole filter", async () => {
    const r = await as(s.bursar).get("/api/fees/invoices?page=2&pageSize=50&year=2026&term=TERM1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 121, page: 2, pageSize: 50 });
    expect(r.body.items).toHaveLength(50);
    expect(r.body.items[0].lines).toBeUndefined(); // details only on /invoices/:id
    expect(r.body.items[0].student).toHaveProperty("admissionNo");
    // 119 issued x 1000 + the base 17,000 invoice; the void one is excluded.
    expect(r.body.totals.billed).toBe(119 * 1000 + 17000);
  });

  it("searches by admission number, name and invoice number", async () => {
    const byAdm = await as(s.bursar).get("/api/fees/invoices?page=1&q=P-007");
    expect(byAdm.body.total).toBe(1);
    const byName = await as(s.bursar).get("/api/fees/invoices?page=1&q=pupil11");
    expect(byName.body.items.map((i) => i.student.firstName)).toContain("Pupil11");
    const byNo = await as(s.bursar).get(`/api/fees/invoices?page=1&q=PG-${s.school.id}-5`);
    expect(byNo.body.total).toBeGreaterThanOrEqual(1);
  });

  it("caps the page size", async () => {
    const r = await as(s.bursar).get("/api/fees/invoices?page=1&pageSize=100000");
    expect(r.body.pageSize).toBe(200);
  });

  it("keeps the old array form without ?page (per-student lookups)", async () => {
    const r = await as(s.bursar).get(`/api/fees/invoices?studentId=${s.students[0].id}`);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body[0].lines.length).toBeGreaterThan(0);
  });
});

describe("student list", () => {
  it("pages and searches when asked", async () => {
    const r = await as(s.admin).get("/api/students?page=1&pageSize=20&q=paged");
    expect(r.body).toMatchObject({ total: 120, page: 1, pageSize: 20 });
    expect(r.body.items).toHaveLength(20);
    expect(Object.keys(r.body.items[0].class).sort()).toEqual(["id", "name", "stream", "year"]);
  });
});
