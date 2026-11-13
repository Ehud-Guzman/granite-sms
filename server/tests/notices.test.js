// Missing feature 10: the school noticeboard.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

process.env.SMS_PROVIDER = "memory";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const post = (body, user = s.admin) => as(user).post("/api/notices").send(body);
const titles = async (user, q = "") => (await as(user).get(`/api/notices${q}`)).body.notices.map((n) => n.title).sort();

describe("notices", () => {
  it("shows each notice only to its audience", async () => {
    expect((await post({ title: "Sports day", body: "Friday from 9am.", audience: "EVERYONE" })).status).toBe(201);
    await post({ title: "Staff meeting", body: "Monday 4pm in the staffroom.", audience: "STAFF" });
    await post({ title: "Grade 7 trip", body: "Bring KES 500.", audience: "FAMILIES", classIds: [s.klass.id] });
    await post({ title: "Grade 8 trip", body: "Bring KES 700.", audience: "FAMILIES", classIds: [s.otherClass.id] });
    await post({ title: "Half term", body: "School closes Thursday.", audience: "FAMILIES" });

    // The learner is in Grade 7.
    expect(await titles(s.studentUser)).toEqual(["Grade 7 trip", "Half term", "Sports day"]);
    expect(await titles(s.teacher)).toEqual(["Sports day", "Staff meeting"]);
    expect(await titles(s.bursar)).toEqual(["Sports day", "Staff meeting"]);
    expect(await titles(s.admin)).toHaveLength(5);
  });

  it("is posted and managed by admins only", async () => {
    expect((await post({ title: "Hello", body: "x" }, s.teacher)).status).toBe(403);
    expect((await post({ title: "Hello", body: "x" }, s.studentUser)).status).toBe(403);
    expect((await post({ title: "Hi", body: "x" })).status).toBe(400); // title too short
    expect((await post({ title: "Hello", body: "x", audience: "NOBODY" })).status).toBe(400);
    expect((await post({ title: "Hello", body: "x", audience: "FAMILIES", classIds: ["not-a-class"] })).status).toBe(400);

    const n = (await post({ title: "Fees deadline", body: "Pay by Friday." })).body.notice;
    expect((await as(s.teacher).patch(`/api/notices/${n.id}`).send({ pinned: true })).status).toBe(403);
    const upd = await as(s.admin).patch(`/api/notices/${n.id}`).send({ pinned: true, title: "Fees deadline extended" });
    expect(upd.status).toBe(200);
    expect(upd.body.notice).toMatchObject({ pinned: true, title: "Fees deadline extended" });
    expect((await as(s.admin).delete(`/api/notices/${n.id}`)).status).toBe(200);
    expect(await titles(s.admin)).toEqual([]);
  });

  it("puts pinned notices first and hides expired ones", async () => {
    await post({ title: "Old news", body: "Gone.", expiresOn: "2020-01-31" });
    await post({ title: "Regular", body: "Normal notice." });
    await post({ title: "Important", body: "Pinned notice.", pinned: true });
    const list = (await as(s.studentUser).get("/api/notices")).body.notices.map((n) => n.title);
    expect(list).toEqual(["Important", "Regular"]);
    expect(await titles(s.admin, "?all=1")).toContain("Old news");
    expect(await titles(s.studentUser, "?all=1")).not.toContain("Old news");
  });

  it("keeps schools apart", async () => {
    const other = await makeSchool();
    const n = (await post({ title: "Our notice", body: "Only for us." })).body.notice;
    expect(await titles(other.studentUser)).toEqual([]);
    expect((await as(other.admin).patch(`/api/notices/${n.id}`).send({ pinned: true })).status).toBe(404);
    expect((await as(other.admin).delete(`/api/notices/${n.id}`)).status).toBe(404);
  });

  it("texts the parents of the chosen classes once per phone", async () => {
    const mum = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "Mary", lastName: "W", phone: "+254712000101" } });
    const dad = await prisma.guardian.create({ data: { schoolId: s.school.id, firstName: "John", lastName: "K", phone: "+254712000102" } });
    // Mary has two children in Grade 7; John's child is in Grade 8.
    for (const st of [s.students[0], s.students[1]]) {
      await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: st.id, guardianId: mum.id, relationship: "MOTHER", isPrimary: true } });
    }
    await prisma.student.update({ where: { id: s.students[2].id }, data: { classId: s.otherClass.id } });
    await prisma.studentGuardian.create({ data: { schoolId: s.school.id, studentId: s.students[2].id, guardianId: dad.id, relationship: "FATHER", isPrimary: true } });

    // SMS has to be switched on first.
    const off = await post({ title: "Trip", body: "Bring KES 500.", audience: "FAMILIES", classIds: [s.klass.id], sendSms: true });
    expect(off.status).toBe(400);
    await as(s.admin).patch("/api/sms/settings").send({ smsEnabled: true });
    expect((await post({ title: "Staff only", body: "x", audience: "STAFF", sendSms: true })).status).toBe(400);

    const r = await post({ title: "Trip", body: "Bring KES 500.", audience: "FAMILIES", classIds: [s.klass.id], sendSms: true });
    expect(r.status).toBe(201);
    expect(r.body.smsQueued).toBe(1);
    const msgs = await prisma.smsMessage.findMany({ where: { schoolId: s.school.id, kind: "NOTICE" } });
    expect(msgs.map((m) => m.to)).toEqual(["+254712000101"]);
    expect(msgs[0].body).toMatch(/^Test School .+: Trip\. Bring KES 500\.$/);

    const all = await post({ title: "Closing day", body: "x".repeat(600), sendSms: true });
    expect(all.body.smsQueued).toBe(2);
    const long = await prisma.smsMessage.findFirst({ where: { schoolId: s.school.id, kind: "NOTICE", to: "+254712000102" } });
    expect(long.body.length).toBeLessThanOrEqual(400);
    expect(long.body).toMatch(/More on the school portal\.$/);
  });
});
