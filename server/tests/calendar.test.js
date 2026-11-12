// M3 (school time zone) and M4 (current term / term dates).
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { localDayRange, localDateString } from "../src/utils/schoolTime.js";
import { invalidateSchoolCalendar } from "../src/utils/schoolTime.js";

describe("school-local days", () => {
  it("a Nairobi day runs 21:00 UTC the evening before to 20:59:59.999 UTC", () => {
    const { from, to } = localDayRange("2026-11-11", "2026-11-11", "Africa/Nairobi");
    expect(from.toISOString()).toBe("2026-11-10T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-11T20:59:59.999Z");
    expect(localDateString(new Date("2026-11-11T22:30:00Z"), "Africa/Nairobi")).toBe("2026-11-12");
  });
});

describe("collections use the school's day", () => {
  let s;
  beforeEach(async () => {
    s = await makeSchool();
  });

  it("a payment at 01:30 Nairobi time counts on that Nairobi day", async () => {
    await prisma.feePayment.create({
      data: {
        schoolId: s.school.id,
        invoiceId: s.invoice.id,
        amount: 500,
        method: "MPESA",
        receiptNo: `R-${s.school.id}`,
        receivedAt: new Date("2026-11-11T22:30:00Z"), // 12 Nov 01:30 in Nairobi
      },
    });
    const on11 = await as(s.bursar).get("/api/fees/reports/collections?from=2026-11-11&to=2026-11-11");
    const on12 = await as(s.bursar).get("/api/fees/reports/collections?from=2026-11-12&to=2026-11-12");
    expect(on11.body.totalCollected).toBe(0);
    expect(on12.body.totalCollected).toBe(500);
  });
});

describe("academic calendar settings", () => {
  let s;
  beforeEach(async () => {
    s = await makeSchool();
  });

  it("saves current term and time zone, and rejects bad values", async () => {
    const bad = await as(s.admin).patch("/api/settings/academics").send({ timezone: "Mars/Olympus" });
    expect(bad.status).toBe(400);
    const badTerm = await as(s.admin).patch("/api/settings/academics").send({ currentTerm: "TERM9" });
    expect(badTerm.status).toBe(400);

    const ok = await as(s.admin).patch("/api/settings/academics").send({ currentTerm: "TERM2", timezone: "Africa/Nairobi" });
    expect(ok.status).toBe(200);
    const me = await as(s.admin).get("/api/me");
    expect(me.body.calendar).toMatchObject({ currentTerm: "TERM2", timezone: "Africa/Nairobi", currentYear: 2026 });
  });

  it("rejects overlapping or back-to-front term dates", async () => {
    const overlap = await as(s.admin)
      .put("/api/settings/academics/term-dates")
      .send({
        year: 2026,
        terms: [
          { term: "TERM1", startsOn: "2026-01-05", endsOn: "2026-04-10" },
          { term: "TERM2", startsOn: "2026-04-01", endsOn: "2026-08-01" },
        ],
      });
    expect(overlap.status).toBe(400);
    const backwards = await as(s.admin)
      .put("/api/settings/academics/term-dates")
      .send({ year: 2026, terms: [{ term: "TERM1", startsOn: "2026-04-01", endsOn: "2026-01-01" }] });
    expect(backwards.status).toBe(400);
  });

  it("works out the current term from the term dates when none is set", async () => {
    const today = localDateString(new Date(), "Africa/Nairobi");
    const year = Number(today.slice(0, 4));
    const r = await as(s.admin)
      .put("/api/settings/academics/term-dates")
      .send({ year, terms: [{ term: "TERM3", startsOn: `${year}-01-01`, endsOn: `${year}-12-31` }] });
    expect(r.status).toBe(200);
    await prisma.schoolSettings.update({ where: { schoolId: s.school.id }, data: { currentAcademicYear: String(year) } });
    invalidateSchoolCalendar(s.school.id);
    const me = await as(s.teacher).get("/api/me");
    expect(me.body.calendar.currentTerm).toBe("TERM3");
    expect(me.body.calendar.currentTermDates).toEqual({ startsOn: `${year}-01-01`, endsOn: `${year}-12-31` });
  });

  it("only admins can change the calendar", async () => {
    const r = await as(s.teacher).patch("/api/settings/academics").send({ currentTerm: "TERM1" });
    expect(r.status).toBe(403);
  });
});
