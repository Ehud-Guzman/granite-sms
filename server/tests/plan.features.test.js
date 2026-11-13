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

  it("shows everything during a trial and nothing once lapsed", async () => {
    await setPlan({ status: "TRIAL", entitlements: {} });
    expect(await features()).toEqual({ fees: true, attendance: true, exams: true });
    await setPlan({ status: "ACTIVE", entitlements: { EXAMS_READ: true }, currentPeriodEnd: new Date(Date.now() - 86400000) });
    expect(await features()).toEqual({ fees: false, attendance: false, exams: false });
    await setPlan({ status: "CANCELED", currentPeriodEnd: null });
    expect(await features()).toEqual({ fees: false, attendance: false, exams: false });
  });
});
