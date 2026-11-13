// Data Protection Act tooling: consent, anonymising former learners, retention.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { applyRetention } from "../src/modules/privacy/privacy.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const exit = (st) => as(s.admin).patch(`/api/students/${st.id}/exit`).send({ status: "GRADUATED", date: "2025-11-20" });

describe("consent", () => {
  it("records who gave consent and when, and can be withdrawn", async () => {
    const st = s.students[0];
    expect((await as(s.teacher).patch(`/api/students/${st.id}/consent`).send({ given: true, by: "Mary W" })).status).toBe(403);
    expect((await as(s.admin).patch(`/api/students/${st.id}/consent`).send({ given: true })).status).toBe(400);

    const r = await as(s.admin).patch(`/api/students/${st.id}/consent`).send({ given: true, by: "Mary W (mother)", date: "2026-01-10", photo: true });
    expect(r.status).toBe(200);
    expect(r.body.consent).toMatchObject({ consentBy: "Mary W (mother)", photoConsent: true });
    expect(r.body.consent.consentAt.slice(0, 10)).toBe("2026-01-10");

    const off = await as(s.admin).patch(`/api/students/${st.id}/consent`).send({ given: false });
    expect(off.body.consent).toMatchObject({ consentAt: null, consentBy: null, photoConsent: false });
  });
});

describe("anonymising a former learner", () => {
  it("only works for learners who have left, with the admission number typed", async () => {
    const st = s.students[1];
    expect((await as(s.admin).post(`/api/students/${st.id}/anonymise`).send({ confirm: st.admissionNo })).status).toBe(400);
    await exit(st);
    expect((await as(s.admin).post(`/api/students/${st.id}/anonymise`).send({ confirm: "wrong" })).status).toBe(400);
    expect((await as(s.teacher).post(`/api/students/${st.id}/anonymise`).send({ confirm: st.admissionNo })).status).toBe(403);
    const other = await makeSchool();
    expect((await as(other.admin).post(`/api/students/${st.id}/anonymise`).send({ confirm: st.admissionNo })).status).toBe(404);
  });

  it("removes names, login and parents but keeps the fee records", async () => {
    const st = s.students[0]; // has the invoice and a login
    const mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: "+254712000201" } });
    const dad = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "John", lastName: "W", phone: "+254712000202" } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: st.id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: st.id, guardianId: dad.id, relationship: "FATHER" } });
    // John also has a child still at the school, so he stays.
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[2].id, guardianId: dad.id, relationship: "FATHER", isPrimary: true } });
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 5000 });
    await prisma.student.update({ where: { id: st.id }, data: { dob: new Date("2012-03-04"), gender: "FEMALE" } });
    await exit(st);

    const r = await as(s.admin).post(`/api/students/${st.id}/anonymise`).send({ confirm: "ADM-1" });
    expect(r.status).toBe(200);
    expect(r.body.guardiansRemoved).toBe(1);

    const after = await prisma.student.findUnique({ where: { id: st.id } });
    expect(after).toMatchObject({ firstName: "Former", lastName: "learner", dob: null, gender: null, userId: null });
    expect(after.admissionNo).toMatch(/^ANON-/);
    expect(after.anonymisedAt).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: s.studentUser.id } })).toBeNull();
    expect(await prisma.guardian.findUnique({ where: { id: mum.id } })).toBeNull();
    expect(await prisma.guardian.findUnique({ where: { id: dad.id } })).not.toBeNull();

    // The money is still there for the school's books.
    const inv = await prisma.feeInvoice.findUnique({ where: { id: s.invoice.id } });
    expect(inv.paid).toBe(5000);
    expect(await prisma.feePayment.count({ where: { studentId: st.id } })).toBe(1);

    // No further edits, and no second run.
    expect((await as(s.admin).patch(`/api/students/${st.id}`).send({ firstName: "Amani" })).status).toBe(409);
    expect((await as(s.admin).patch(`/api/students/${st.id}/consent`).send({ given: true, by: "X Y" })).status).toBe(409);
    expect((await as(s.admin).post(`/api/students/${st.id}/anonymise`).send({ confirm: after.admissionNo })).status).toBe(409);
  });
});

describe("retention", () => {
  it("reports first, then removes old logs and anonymises long-gone leavers", async () => {
    const old = new Date("2015-01-01");
    await prisma.auditLog.create({ data: { schoolId: s.school.id, action: "OLD_THING", createdAt: old } });
    await prisma.auditLog.create({ data: { schoolId: s.school.id, action: "NEW_THING" } });
    await prisma.smsMessage.create({ data: { schoolId: s.school.id, to: "+254712000203", body: "old", kind: "BROADCAST", status: "SENT", createdAt: old } });
    await prisma.student.update({ where: { id: s.students[2].id }, data: { isActive: false, exitStatus: "GRADUATED", exitDate: new Date("2016-11-20") } });

    const report = await applyRetention({ schoolId: s.school.id });
    expect(report).toMatchObject({ auditLogs: 1, smsMessages: 1, leaversDue: 1, write: false });
    expect(await prisma.auditLog.count({ where: { schoolId: s.school.id, action: "OLD_THING" } })).toBe(1);

    const done = await applyRetention({ schoolId: s.school.id, write: true, anonymiseLeavers: true });
    expect(done.leaversAnonymised).toBe(1);
    expect(await prisma.auditLog.count({ where: { schoolId: s.school.id, action: "OLD_THING" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { schoolId: s.school.id, action: "NEW_THING" } })).toBe(1);
    expect(await prisma.smsMessage.count({ where: { schoolId: s.school.id } })).toBe(0);
    expect((await prisma.student.findUnique({ where: { id: s.students[2].id } })).firstName).toBe("Former");
  });
});
