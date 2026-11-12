// M16 (logos survive redeploys: stored in the database) and L7 (content check).
import { describe, it, expect, beforeAll } from "vitest";
import { as, app, request, prisma, makeSchool } from "./helpers.js";

// A real 1x1 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

let s;
beforeAll(async () => {
  s = await makeSchool();
});

describe("school logo", () => {
  it("is stored in the database and served publicly with long caching", async () => {
    const up = await as(s.admin).post("/api/settings/branding/logo").attach("logo", PNG, { filename: "logo.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const url = up.body.branding.brandLogoUrl;
    expect(url).toMatch(new RegExp(`^/api/public/schools/${s.school.id}/logo/[0-9a-f]{16}$`));
    expect(await prisma.schoolLogo.count({ where: { schoolId: s.school.id } })).toBe(1);

    const img = await request(app).get(url); // no sign-in
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(img.body, PNG)).toBe(0);
  });

  it("rejects a non-image sent with an image type", async () => {
    const html = Buffer.from("<script>alert(1)</script>".padEnd(64, " "));
    const r = await as(s.admin).post("/api/settings/branding/logo").attach("logo", html, { filename: "x.png", contentType: "image/png" });
    expect(r.status).toBe(400);
  });

  it("only admins can upload", async () => {
    const r = await as(s.teacher).post("/api/settings/branding/logo").attach("logo", PNG, { filename: "l.png", contentType: "image/png" });
    expect(r.status).toBe(403);
  });
});
