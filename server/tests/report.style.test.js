// Schools choose how their report cards and result slips look.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";

let s;
beforeEach(async () => {
  s = await makeSchool();
});

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;
const preview = (body, user = s.admin) => as(user).post("/api/settings/print/preview").send(body).buffer(true).parse(binary);

describe("report design", () => {
  it("starts on the defaults", async () => {
    const r = await as(s.admin).get("/api/settings/print");
    expect(r.status).toBe(200);
    expect(r.body.print.reportStyle).toMatchObject({ layout: "classic", font: "sans", reportTitle: "Report card", show: { position: true, feeBalance: false } });
    expect(r.body.print.reportStyle.signatures).toHaveLength(3);
  });

  it("saves a school's design and fills the gaps with defaults", async () => {
    const r = await as(s.admin)
      .patch("/api/settings/print")
      .send({
        printHeaderText: "P.O. Box 12, Nakuru",
        reportStyle: { layout: "modern", accent: "#0f766e", motto: "Strive for excellence", reportTitle: "Progress report", show: { position: false, feeBalance: true }, signatures: ["Class teacher", "Principal"] },
      });
    expect(r.status).toBe(200);
    expect(r.body.print.reportStyle).toMatchObject({ layout: "modern", accent: "#0f766e", reportTitle: "Progress report", slipTitle: "Result slip", show: { position: false, feeBalance: true, attendance: true } });
    expect(r.body.print.reportStyle.signatures).toEqual(["Class teacher", "Principal"]);
    const stored = await prisma.schoolSettings.findUnique({ where: { schoolId: s.school.id } });
    expect(stored.reportStyle.layout).toBe("modern");

    // null puts it back.
    const reset = await as(s.admin).patch("/api/settings/print").send({ reportStyle: null });
    expect(reset.body.print.reportStyle.layout).toBe("classic");
  });

  it("refuses bad designs, and anyone but an admin", async () => {
    const bad = (style) => as(s.admin).patch("/api/settings/print").send({ reportStyle: style });
    expect((await bad({ layout: "fancy" })).status).toBe(400);
    expect((await bad({ accent: "red" })).status).toBe(400);
    expect((await bad({ show: { secrets: true } })).status).toBe(400);
    expect((await bad({ signatures: ["a", "b", "c", "d"] })).status).toBe(400);
    expect((await as(s.teacher).patch("/api/settings/print").send({ reportStyle: { layout: "modern" } })).status).toBe(403);
  });

  it("previews every layout as a one-page PDF without saving", async () => {
    for (const layout of ["classic", "modern", "compact"]) {
      for (const kind of ["report", "slip"]) {
        const r = await preview({ kind, print: { printHeaderText: "P.O. Box 12", reportStyle: { layout, font: "serif", closingNote: "Next term opens on 5 January.", show: { feeBalance: true } } } });
        expect(r.status).toBe(200);
        expect(r.headers["content-type"]).toMatch(/application\/pdf/);
        expect(pages(r.body)).toBe(1);
      }
    }
    const stored = await prisma.schoolSettings.findUnique({ where: { schoolId: s.school.id } });
    expect(stored?.reportStyle ?? null).toBeNull();
    expect((await preview({ kind: "report" }, s.teacher)).status).toBe(403);
  });
});
