// M2: registers start unmarked, stay inside term and can't be dated ahead.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { localDateString, invalidateSchoolCalendar } from "../src/utils/schoolTime.js";

const today = () => localDateString(new Date(), "Africa/Nairobi");
const daysAgo = (n) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const open = (user, date, extra = {}) =>
  as(user)
    .post("/api/attendance/sessions")
    .send({ classId: s.klass.id, date, year: Number(date.slice(0, 4)), term: "TERM1", ...extra });

describe("register dates", () => {
  it("refuses a future date", async () => {
    const tomorrow = new Date(`${today()}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const r = await open(s.teacher, tomorrow.toISOString().slice(0, 10));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ATTENDANCE_FUTURE_DATE");
  });

  it("lets teachers backdate a week, and only admins further", async () => {
    expect((await open(s.teacher, daysAgo(6))).status).toBe(200);
    const old = await open(s.teacher, daysAgo(10));
    expect(old.status).toBe(403);
    expect(old.body.code).toBe("ATTENDANCE_TOO_OLD");
    expect((await open(s.admin, daysAgo(10))).status).toBe(200);
  });

  it("refuses a year that doesn't match the date", async () => {
    const r = await open(s.admin, daysAgo(1), { year: 2000 });
    expect(r.status).toBe(400);
  });

  it("with term dates: takes the term from the date and refuses dates outside term", async () => {
    const t = today();
    const year = Number(t.slice(0, 4));
    // Make the current term run up to yesterday; today falls in the holiday.
    await prisma.termDate.create({
      data: {
        schoolId: s.school.id,
        year,
        term: "TERM2",
        startsOn: new Date(`${daysAgo(20)}T00:00:00Z`),
        endsOn: new Date(`${daysAgo(1)}T00:00:00Z`),
      },
    });
    invalidateSchoolCalendar(s.school.id);

    const inTerm = await open(s.admin, daysAgo(2), { term: "TERM1" });
    expect(inTerm.status).toBe(200);
    expect(inTerm.body.session.term).toBe("TERM2"); // from the dates, not the request

    const holiday = await open(s.admin, t);
    expect(holiday.status).toBe(400);
    expect(holiday.body.code).toBe("ATTENDANCE_OUTSIDE_TERM");
  });
});

describe("marking", () => {
  it("starts everyone unmarked and won't submit until all are marked", async () => {
    const opened = await open(s.teacher, today());
    const id = opened.body.session.id;
    const session = await as(s.teacher).get(`/api/attendance/sessions/${id}`);
    expect(session.body.records.map((r) => r.status)).toEqual(["UNMARKED", "UNMARKED", "UNMARKED"]);

    const early = await as(s.teacher).post(`/api/attendance/sessions/${id}/submit`).send({});
    expect(early.status).toBe(409);

    const bad = await as(s.teacher)
      .put(`/api/attendance/sessions/${id}/records`)
      .send({ records: [{ studentId: s.students[0].id, status: "UNMARKED" }] });
    expect(bad.status).toBe(400);

    const mark = await as(s.teacher)
      .put(`/api/attendance/sessions/${id}/records`)
      .send({
        records: [
          { studentId: s.students[0].id, status: "PRESENT" },
          { studentId: s.students[1].id, status: "LATE", minutesLate: 10 },
          { studentId: s.students[2].id, status: "ABSENT" },
        ],
      });
    expect(mark.status).toBe(200);
    expect((await as(s.teacher).post(`/api/attendance/sessions/${id}/submit`).send({})).status).toBe(200);

    // Re-opening a submitted register changes nothing.
    const again = await open(s.teacher, today(), { term: "TERM3" });
    expect(again.status).toBe(200);
    expect(again.body.session).toMatchObject({ id, status: "SUBMITTED", term: "TERM1" });
  });

  it("summaries ignore unmarked rows and count late as attending", async () => {
    const opened = await open(s.teacher, today());
    const id = opened.body.session.id;
    await as(s.teacher)
      .put(`/api/attendance/sessions/${id}/records`)
      .send({ records: [{ studentId: s.students[1].id, status: "LATE", minutesLate: 5 }] });

    const late = await as(s.admin).get(`/api/attendance/summary/student/${s.students[1].id}`);
    expect(late.body).toMatchObject({ total: 1, late: 1, attendanceRatePct: 100 });
    const unmarked = await as(s.admin).get(`/api/attendance/summary/student/${s.students[2].id}`);
    expect(unmarked.body.total).toBe(0);
  });
});
