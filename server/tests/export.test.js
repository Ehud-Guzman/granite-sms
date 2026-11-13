// M13: a school can export all of its own data.
import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { as, prisma, makeSchool } from "./helpers.js";

let s;
beforeAll(async () => {
  s = await makeSchool();
  const g = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: "+254712345678" } });
  await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[0].id, guardianId: g.id, relationship: "MOTHER", isPrimary: true } });
  await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 1000 });
});

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("school data export", () => {
  it("gives an admin a workbook with every sheet filled", async () => {
    const r = await as(s.admin).get("/api/settings/export").buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(["Learners", "Guardians", "Classes", "Staff", "Invoices", "Payments", "Results", "Marks", "Attendance"]);
    expect(wb.getWorksheet("Learners").rowCount).toBe(4); // header + 3
    expect(wb.getWorksheet("Guardians").getRow(2).getCell(5).value).toBe("+254712345678");
    expect(wb.getWorksheet("Payments").getRow(2).getCell(4).value).toBe(1000);
    // Staff sheet never includes password hashes.
    expect(JSON.stringify(wb.getWorksheet("Staff").getSheetValues())).not.toMatch(/\$2[aby]\$/);
  });

  it("exports one learner's data as JSON, and is admin-only", async () => {
    const r = await as(s.admin).get(`/api/settings/export/student/${s.students[0].id}`);
    expect(r.status).toBe(200);
    expect(r.body.student.admissionNo).toBe("ADM-1");
    expect(r.body.student.guardianLinks[0].guardian.phone).toBe("+254712345678");
    expect(r.body.student.feeInvoices[0].payments).toHaveLength(1);
    expect((await as(s.teacher).get("/api/settings/export")).status).toBe(403);
    expect((await as(s.bursar).get(`/api/settings/export/student/${s.students[0].id}`)).status).toBe(403);
  });

  it("can't reach another school's learner", async () => {
    const other = await makeSchool();
    expect((await as(other.admin).get(`/api/settings/export/student/${s.students[0].id}`)).status).toBe(404);
  });
});
