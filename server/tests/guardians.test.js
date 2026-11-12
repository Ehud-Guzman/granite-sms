// Parents/guardians: phone normalisation, shared siblings, primary contact, access.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { normalizeKenyanPhone, normalizePhone } from "../src/utils/phone.js";

describe("phone numbers", () => {
  it.each([
    ["0712 345 678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+254 712-345-678", "+254712345678"],
    ["0110 123 456", "+254110123456"],
    ["712345678", "+254712345678"],
  ])("%s -> %s", (raw, want) => expect(normalizeKenyanPhone(raw)).toBe(want));

  it("rejects non-mobiles and accepts +international", () => {
    expect(normalizeKenyanPhone("020 123 4567")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
  });
});

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const add = (studentId, body, user = s.admin) => as(user).post(`/api/guardians/student/${studentId}`).send(body);

describe("guardians", () => {
  it("adds a guardian; the first one becomes the primary contact", async () => {
    const r = await add(s.students[0].id, { firstName: "Mary", lastName: "Wanjiku", phone: "0712345678", relationship: "mother" });
    expect(r.status).toBe(201);
    expect(r.body.guardians).toHaveLength(1);
    expect(r.body.guardians[0]).toMatchObject({ relationship: "MOTHER", isPrimary: true, guardian: { phone: "+254712345678" } });
  });

  it("re-uses a parent with the same phone for a sibling, and shows the other child", async () => {
    await add(s.students[0].id, { firstName: "Mary", lastName: "Wanjiku", phone: "0712345678", relationship: "MOTHER" });
    const r = await add(s.students[1].id, { firstName: "M.", lastName: "W.", phone: "+254 712 345 678", relationship: "MOTHER" });
    expect(r.body.linkedExisting).toBe(true);
    expect(await prisma.guardian.count({ where: { schoolId: s.school.id } })).toBe(1);
    expect(r.body.guardians[0].guardian.firstName).toBe("Mary"); // existing details kept
    expect(r.body.guardians[0].otherChildren.map((c) => c.admissionNo)).toEqual(["ADM-1"]);
  });

  it("keeps exactly one primary contact per student", async () => {
    await add(s.students[0].id, { firstName: "Mary", lastName: "W", phone: "0712345678", relationship: "MOTHER" });
    const r = await add(s.students[0].id, { firstName: "John", lastName: "W", phone: "0722000111", relationship: "FATHER", isPrimary: true });
    expect(r.body.guardians.filter((g) => g.isPrimary).map((g) => g.guardian.firstName)).toEqual(["John"]);

    // Removing the primary hands it to the remaining guardian.
    const father = r.body.guardians.find((g) => g.guardian.firstName === "John");
    const del = await as(s.admin).delete(`/api/guardians/links/${father.linkId}`);
    expect(del.body.guardians).toHaveLength(1);
    expect(del.body.guardians[0]).toMatchObject({ isPrimary: true, guardian: { firstName: "Mary" } });
    expect(await prisma.guardian.count({ where: { schoolId: s.school.id, firstName: "John" } })).toBe(0);
  });

  it("validates input", async () => {
    expect((await add(s.students[0].id, { firstName: "A", lastName: "B", phone: "123" })).status).toBe(400);
    expect((await add(s.students[0].id, { firstName: "A", lastName: "B", phone: "0712345678", relationship: "UNCLE" })).status).toBe(400);
    await add(s.students[0].id, { firstName: "A", lastName: "B", phone: "0712345678" });
    expect((await add(s.students[0].id, { firstName: "A", lastName: "B", phone: "0712345678" })).status).toBe(409);
  });

  it("teachers see guardians of their own classes only and can't edit", async () => {
    await add(s.students[0].id, { firstName: "Mary", lastName: "W", phone: "0712345678" });
    expect((await as(s.teacher).get(`/api/guardians/student/${s.students[0].id}`)).body.guardians).toHaveLength(1);
    expect((await as(s.teacher2).get(`/api/guardians/student/${s.students[0].id}`)).status).toBe(403);
    expect((await add(s.students[0].id, { firstName: "X", lastName: "Y", phone: "0700000001" }, s.teacher)).status).toBe(403);
  });

  it("bursars can search guardians by phone", async () => {
    await add(s.students[0].id, { firstName: "Mary", lastName: "Wanjiku", phone: "0712345678" });
    const r = await as(s.bursar).get("/api/guardians?q=0712345678");
    expect(r.body.guardians).toHaveLength(1);
    expect(r.body.guardians[0].students[0].student.admissionNo).toBe("ADM-1");
  });

  it("another school can't see or link to this school's students", async () => {
    const other = await makeSchool();
    expect((await as(other.admin).get(`/api/guardians/student/${s.students[0].id}`)).status).toBe(404);
    expect((await add(s.students[0].id, { firstName: "A", lastName: "B", phone: "0712345678" }, other.admin)).status).toBe(404);
  });
});
