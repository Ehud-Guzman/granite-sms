// The app only shows modules the school's plan includes (/api/me features).
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const setPlan = (data) => prisma.subscription.updateMany({ where: { schoolId: s.school.id }, data });
const features = async (user = s.teacher) => (await as(user).get("/api/me")).body.features;

describe("plan features on /api/me", () => {
  it("lists only the modules the plan grants", async () => {
    await setPlan({ status: "ACTIVE", entitlements: { FEES_READ: true, FEES_WRITE: true, ATTENDANCE_WRITE: true } });
    expect(await features()).toEqual({ fees: true, attendance: true, exams: false });
    expect(await features(s.admin)).toEqual({ fees: true, attendance: true, exams: false });
  });

  it("shows everything during a trial", async () => {
    await setPlan({ status: "TRIAL", entitlements: {} });
    expect(await features()).toEqual({ fees: true, attendance: true, exams: true });
    expect((await as(s.admin).get("/api/me")).body.plan).toMatchObject({ status: "TRIAL", readOnly: false });
  });

  it("keeps a lapsed plan's modules read-only: they open, but changes are refused", async () => {
    await setPlan({ status: "ACTIVE", entitlements: { EXAMS_READ: true, EXAMS_WRITE: true, FEES_READ: true }, currentPeriodEnd: new Date(Date.now() - 86400000) });
    expect(await features()).toEqual({ fees: true, attendance: false, exams: true });
    expect((await as(s.admin).get("/api/me")).body.plan).toMatchObject({ readOnly: true });

    // Reading still works…
    expect((await as(s.teacher).get("/api/exams/sessions?year=2026")).status).toBe(200);
    expect((await as(s.bursar).get("/api/fees/reports/class-summary?year=2026&term=TERM1")).status).toBe(200);
    // …changing doesn't.
    const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "Opener" } });
    const create = await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id });
    expect(create.status).toBe(402);
    expect((await as(s.bursar).post("/api/fees/payments").send({ invoiceId: s.invoice.id, amount: 100 })).status).toBe(402);

    // A module the plan never had stays shut.
    expect([402, 403]).toContain((await as(s.teacher).get("/api/attendance/summary/class/" + s.klass.id)).status);

    await setPlan({ status: "CANCELED", currentPeriodEnd: null });
    expect(await features()).toEqual({ fees: true, attendance: false, exams: true });
  });
});
