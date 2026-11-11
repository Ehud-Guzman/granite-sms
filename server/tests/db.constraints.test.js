// C3: the database itself must protect financial and attendance history.
import { describe, it, expect } from "vitest";
import { prisma, makeSchool } from "./helpers.js";

describe("database constraints", () => {
  it("blocks deleting a student who has an invoice", async () => {
    const s = await makeSchool();
    await expect(prisma.student.delete({ where: { id: s.students[0].id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("blocks an invoice for a student that doesn't exist", async () => {
    const s = await makeSchool();
    await expect(
      prisma.feeInvoice.create({
        data: {
          schoolId: s.school.id,
          studentId: "does-not-exist",
          classId: s.klass.id,
          year: 2026,
          term: "TERM2",
          invoiceNo: `X-${s.school.id}`,
          total: 1,
          balance: 1,
        },
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("blocks deleting a class that has a fee plan", async () => {
    const s = await makeSchool();
    await expect(prisma.class.delete({ where: { id: s.klass.id } })).rejects.toMatchObject({ code: "P2003" });
  });
});
