// Missing feature 2: SMS to parents (outbox, triggers, reminders, broadcast).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { flushOutbox, sentForTests } from "../src/modules/sms/sms.js";

process.env.SMS_PROVIDER = "memory";

let s, mum;
beforeEach(async () => {
  s = await makeSchool();
  mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: "+254712000001" } });
  // Mary is the primary parent of learners 1 and 2 (siblings).
  for (const st of [s.students[0], s.students[1]]) {
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: st.id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
  }
});

const enable = (extra = {}) => as(s.admin).patch("/api/sms/settings").send({ smsEnabled: true, ...extra });
const outbox = (kind) => prisma.smsMessage.findMany({ where: { schoolId: s.school.id, ...(kind ? { kind } : {}) } });

describe("sms", () => {
  it("is off until the school turns it on", async () => {
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(await outbox()).toHaveLength(0);
  });

  it("texts the primary parent a receipt when a payment is posted", async () => {
    await enable();
    await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 5000 });
    await vi.waitFor(async () => expect(await outbox("PAYMENT")).toHaveLength(1));
    const [m] = await outbox("PAYMENT");
    expect(m.to).toBe("+254712000001");
    expect(m.body).toMatch(/received KES 5,000 for Student1 Test \(ADM-1\)\. Receipt RCPT-\d{4}-000001\. Balance KES 12,000\./);
    await flushOutbox();
    expect((await prisma.smsMessage.findUnique({ where: { id: m.id } })).status).toBe("SENT");
    expect(sentForTests.some((x) => x.body === m.body)).toBe(true);
  });

  it("marks messages SKIPPED (not lost) when no provider is configured", async () => {
    await enable();
    process.env.SMS_PROVIDER = "";
    try {
      await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 100 });
      await vi.waitFor(async () => expect((await outbox("PAYMENT"))[0]?.status).toBe("SKIPPED"));
      expect((await outbox("PAYMENT"))[0].error).toMatch(/No SMS provider/);
    } finally {
      process.env.SMS_PROVIDER = "memory";
    }
  });

  it("sends absence alerts when a register is submitted, if switched on", async () => {
    await enable({ smsOnAbsence: true });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
    const open = await as(s.teacher).post("/api/attendance/sessions").send({ classId: s.klass.id, date: today, year: Number(today.slice(0, 4)), term: "TERM1" });
    const id = open.body.session.id;
    await as(s.teacher).put(`/api/attendance/sessions/${id}/records`).send({
      records: [
        { studentId: s.students[0].id, status: "ABSENT" },
        { studentId: s.students[1].id, status: "PRESENT" },
        { studentId: s.students[2].id, status: "PRESENT" },
      ],
    });
    await as(s.teacher).post(`/api/attendance/sessions/${id}/submit`).send({});
    await vi.waitFor(async () => expect(await outbox("ABSENCE")).toHaveLength(1));
    expect((await outbox("ABSENCE"))[0].body).toMatch(/Student1 \(ADM-1\) was marked absent/);
  });

  it("fee reminders: preview, then queue one per learner who owes enough", async () => {
    await enable({ smsPaymentInstructions: "Pay via Paybill 123456, account = adm no." });
    const preview = await as(s.bursar).post("/api/sms/fee-reminders").send({ dryRun: true, minBalance: 1000 });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, learners: 1, messages: 1 }); // only learner 1 has an invoice
    expect(preview.body.sample[0]).toMatch(/fee balance is KES 17,000\. Pay via Paybill 123456/);

    const sent = await as(s.bursar).post("/api/sms/fee-reminders").send({ minBalance: 20000 });
    expect(sent.body.learners).toBe(0);
    const real = await as(s.bursar).post("/api/sms/fee-reminders").send({});
    expect(real.body.queued).toBe(1);
  });

  it("broadcast reaches each parent phone once, and is admin-only", async () => {
    await enable();
    expect((await as(s.bursar).post("/api/sms/broadcast").send({ message: "School closes Friday." })).status).toBe(403);
    const r = await as(s.admin).post("/api/sms/broadcast").send({ message: "School closes Friday at noon.", classIds: [s.klass.id] });
    expect(r.body.queued).toBe(1); // Mary has two children here: one message
    expect((await outbox("BROADCAST"))[0].body).toMatch(/: School closes Friday at noon\.$/);
  });

  it("tells parents when results are published", async () => {
    await enable();
    const maths = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Mathematics" } });
    await prisma.teachingAssignment.create({ data: { schoolId: s.school.id, classId: s.klass.id, subjectId: maths.id, teacherId: s.teacher.teacherId, isActive: true } });
    const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "End term" } });
    const sess = (await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id, name: "End term 1" })).body.data;
    const ms = await prisma.markSheet.findFirst({ where: { examSessionId: sess.id } });
    await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: [80, 60, 40][i] })) });
    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
    await as(s.admin).post(`/api/exams/sessions/${sess.id}/publish`).send({});
    await vi.waitFor(async () => expect(await outbox("RESULTS")).toHaveLength(2)); // Mary, for each of her two children
    const bodies = (await outbox("RESULTS")).map((m) => m.body).sort();
    expect(bodies[0]).toMatch(/Student1's End term 1 results are out: average 80, grade A, position 1 of 3./);
  });

  it("refuses reminders and broadcasts while SMS is off", async () => {
    expect((await as(s.admin).post("/api/sms/broadcast").send({ message: "Hello parents" })).body.code).toBe("SMS_DISABLED");
    expect((await as(s.bursar).post("/api/sms/fee-reminders").send({})).status).toBe(400);
  });
});
