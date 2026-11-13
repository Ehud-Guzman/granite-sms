// Missing feature 8: bulk import of learners from CSV / Excel.
import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { as, prisma, makeSchool } from "./helpers.js";
import { invalidateSchoolCalendar } from "../src/utils/schoolTime.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
  await prisma.schoolSettings.update({ where: { schoolId: s.school.id }, data: { currentAcademicYear: "2026" } });
  invalidateSchoolCalendar(s.school.id);
});

const csv = (lines) => Buffer.from(lines.join("\n"));
const send = (buf, name, dryRun = true, user = s.admin) =>
  as(user).post(`/api/students/import${dryRun ? "?dryRun=1" : ""}`).attach("file", buf, { filename: name });

const GOOD = csv([
  "Adm No,First Name,Surname,Sex,Date of Birth,Class,Parent Name,Parent Phone,Relationship",
  "N-001,Amani,Otieno,M,20/05/2014,Grade 7 E,Jane Otieno,0712 000 111,Mother",
  "N-002,Baraka,Otieno,boy,2013-02-01,Grade 7E,Jane Otieno,+254712000111,Mother",
  "N-003,Chebet,Kiprop,F,,Grade 8,,,",
]);

describe("student import", () => {
  it("previews without saving, matching common headings and class names", async () => {
    const r = await send(GOOD, "learners.csv");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, valid: 3, invalid: 0 });
    expect(r.body.rows.map((x) => x.className)).toEqual(["Grade 7 E (2026)", "Grade 7 E (2026)", "Grade 8 E (2026)"]);
    expect(await prisma.student.count({ where: { schoolId: s.school.id, admissionNo: { startsWith: "N-" } } })).toBe(0);
  });

  it("imports everything, with siblings sharing one parent", async () => {
    const r = await send(GOOD, "learners.csv", false);
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(3);
    const amani = await prisma.student.findFirst({ where: { schoolId: s.school.id, admissionNo: "N-001" } });
    expect(amani).toMatchObject({ gender: "MALE", classId: s.klass.id });
    expect(amani.dob.toISOString().slice(0, 10)).toBe("2014-05-20"); // day-first date understood
    expect(await prisma.guardian.count({ where: { schoolId: s.school.id } })).toBe(1);
    expect(await prisma.studentGuardian.count({ where: { schoolId: s.school.id } })).toBe(2);
  });

  it("reports every problem and imports nothing if any row is bad", async () => {
    const bad = csv([
      "Admission Number,First Name,Last Name,Gender,Class,Parent Phone,Parent Name",
      "ADM-1,Dup,Existing,M,Grade 7 E,,", // already in the school
      "X-1,Ok,One,F,Grade 99,,", // unknown class
      "X-1,Twice,Same,F,Grade 7 E,,", // duplicate in file
      "X-2,,NoFirst,banana,Grade 7 E,12345,Someone", // missing name, bad gender, bad phone
    ]);
    const r = await send(bad, "bad.csv", false);
    expect(r.status).toBe(400);
    expect(r.body.invalid).toBe(4);
    const errs = r.body.rows.map((x) => x.errors.join("; "));
    expect(errs[0]).toMatch(/already exists/);
    expect(errs[1]).toMatch(/not found/);
    expect(errs[2]).toMatch(/twice/);
    expect(errs[3]).toMatch(/first name.*gender|gender.*first name/s);
    expect(await prisma.student.count({ where: { schoolId: s.school.id, admissionNo: { startsWith: "X-" } } })).toBe(0);
  });

  it("reads Excel files", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Learners");
    ws.addRow(["Admission No", "First Name", "Last Name", "Date of Birth", "Class", "Stream"]);
    ws.addRow(["XL-1", "Ewa", "Mutua", new Date(Date.UTC(2014, 0, 9)), "Grade 7", "E"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await send(buf, "learners.xlsx", false);
    expect(r.status).toBe(201);
    const ewa = await prisma.student.findFirst({ where: { schoolId: s.school.id, admissionNo: "XL-1" } });
    expect(ewa.classId).toBe(s.klass.id);
    expect(ewa.dob.toISOString().slice(0, 10)).toBe("2014-01-09");
  });

  it("needs the key columns, an admin, and room on the plan", async () => {
    expect((await send(csv(["Name,Class", "A,B"]), "x.csv")).status).toBe(400);
    expect((await send(GOOD, "learners.csv", true, s.teacher)).status).toBe(403);
    await prisma.subscription.updateMany({ where: { schoolId: s.school.id }, data: { maxStudents: 4 } });
    const full = await send(GOOD, "learners.csv");
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("LIMIT_REACHED");
  });
});
