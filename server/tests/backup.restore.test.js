// C2: in-app restore must never destroy data or change existing accounts.
import { describe, it, expect, beforeAll } from "vitest";
import { as, prisma, makeSchool, makeSystemAdmin } from "./helpers.js";

let s, sys, backupId;
beforeAll(async () => {
  s = await makeSchool();
  sys = await makeSystemAdmin();
  const r = await as(sys).post("/api/settings/backup/create").set("x-school-id", s.school.id).send({});
  expect(r.status).toBe(201);
  backupId = r.body.backupId;
});

const restore = (body) =>
  as(sys).post(`/api/settings/backup/${backupId}/restore`).set("x-school-id", s.school.id).send(body);

describe("in-app restore", () => {
  it("refuses REPLACE", async () => {
    const r = await restore({ mode: "REPLACE", confirm: "DELETE SCHOOL DATA" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("RESTORE_REPLACE_DISABLED");
    expect(await prisma.feeInvoice.count({ where: { schoolId: s.school.id } })).toBe(1);
  });

  it("MERGE leaves existing accounts and the plan alone", async () => {
    // Since the snapshot: the teacher was made a bursar and changed their password,
    // and the school moved plan.
    await prisma.user.update({ where: { id: s.teacher.id }, data: { role: "BURSAR", mustChangePassword: false } });
    await prisma.subscription.updateMany({ where: { schoolId: s.school.id }, data: { planCode: "ENTERPRISE" } });
    const subsBefore = await prisma.subscription.count({ where: { schoolId: s.school.id } });

    const r = await restore({ mode: "MERGE" });
    expect(r.status).toBe(200);

    const t = await prisma.user.findUnique({ where: { id: s.teacher.id } });
    expect(t.role).toBe("BURSAR");
    expect(t.mustChangePassword).toBe(false);
    expect(await prisma.subscription.count({ where: { schoolId: s.school.id } })).toBe(subsBefore);
    const latest = await prisma.subscription.findFirst({ where: { schoolId: s.school.id }, orderBy: { createdAt: "desc" } });
    expect(latest.planCode).toBe("ENTERPRISE");
  });

  it("MERGE brings back a deleted student record", async () => {
    const extra = await prisma.student.create({
      data: { schoolId: s.school.id, admissionNo: "NEW-9", firstName: "Late", lastName: "Joiner", classId: s.klass.id },
    });
    const b2 = await as(sys).post("/api/settings/backup/create").set("x-school-id", s.school.id).send({});
    await prisma.student.delete({ where: { id: extra.id } });
    const r = await as(sys)
      .post(`/api/settings/backup/${b2.body.backupId}/restore`)
      .set("x-school-id", s.school.id)
      .send({ mode: "MERGE" });
    expect(r.status).toBe(200);
    expect(await prisma.student.count({ where: { schoolId: s.school.id, admissionNo: "NEW-9" } })).toBe(1);
  });
});
