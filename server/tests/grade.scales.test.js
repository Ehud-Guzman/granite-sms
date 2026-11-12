// H8: configurable grading (CBE rubric, KCSE points), per class.
import { describe, it, expect, beforeEach } from "vitest";
import { as, prisma, makeSchool } from "./helpers.js";
import { makeGrader, validateBands, SCALE_TEMPLATES } from "../src/modules/exams/exams.grades.js";

describe("grading engine", () => {
  it("templates are valid scales", () => {
    for (const t of Object.values(SCALE_TEMPLATES)) expect(validateBands(t.bands)).toBeNull();
  });

  it("catches gaps, overlaps and bad ends", () => {
    expect(validateBands([{ label: "A", minScore: 50, maxScore: 100 }, { label: "B", minScore: 0, maxScore: 48 }])).toMatch(/49/);
    expect(validateBands([{ label: "A", minScore: 40, maxScore: 100 }, { label: "B", minScore: 0, maxScore: 50 }])).toMatch(/overlap/);
    expect(validateBands([{ label: "A", minScore: 50, maxScore: 99 }, { label: "B", minScore: 0, maxScore: 49 }])).toMatch(/100/);
  });

  it("grades with the CBE junior school rubric", () => {
    const g = makeGrader({ name: "CBE", overallBy: "AVERAGE", bands: SCALE_TEMPLATES.CBE_JSS.bands });
    expect(g.grade(92).label).toBe("EE1");
    expect(g.grade(74.6).label).toBe("EE2"); // rounds to 75
    expect(g.grade(41).label).toBe("ME2");
    expect(g.grade(0).label).toBe("BE2");
  });

  it("KCSE overall grade comes from mean points, not mean marks", () => {
    const g = makeGrader({ name: "KCSE", overallBy: "POINTS", bands: SCALE_TEMPLATES.KCSE.bands });
    // Marks 100, 100, 0 -> points 12, 12, 1 -> mean 8.33 -> 8 points = B-.
    // The mean mark (66.7) would have given B, so this shows points are used.
    const r = g.overall([100, 100, 0]);
    expect(r).toEqual({ grade: "B-", meanPoints: 8.33 });
  });

  it("the built-in default is unchanged A–E by average", () => {
    const g = makeGrader(null);
    expect(g.overall([80, 70])).toEqual({ grade: "A-", meanPoints: null });
  });
});

describe("grade scales API and results", () => {
  let s;
  beforeEach(async () => {
    s = await makeSchool();
  });

  it("creates from a template, sets it on a class, and results use it", async () => {
    const c = await as(s.admin).post("/api/grade-scales").send({ template: "CBE_JSS" });
    expect(c.status).toBe(201);
    expect(c.body.scale.bands).toHaveLength(8);
    expect((await as(s.admin).put("/api/grade-scales/assign").send({ classIds: [s.klass.id], gradeScaleId: c.body.scale.id })).status).toBe(200);

    // A session with one subject, marks 92 / 60 / 20.
    const maths = await prisma.subject.create({ data: { schoolId: s.school.id, name: "Mathematics" } });
    await prisma.teachingAssignment.create({ data: { schoolId: s.school.id, classId: s.klass.id, subjectId: maths.id, teacherId: s.teacher.teacherId, isActive: true } });
    const type = await prisma.examType.create({ data: { schoolId: s.school.id, name: "End term" } });
    const sess = (await as(s.admin).post("/api/exams/sessions").send({ year: 2026, term: "TERM1", classId: s.klass.id, examTypeId: type.id })).body.data;
    const ms = await prisma.markSheet.findFirst({ where: { examSessionId: sess.id } });
    await as(s.teacher).put(`/api/exams/marksheets/${ms.id}/marks`).send({ marks: s.students.map((st, i) => ({ studentId: st.id, score: [92, 60, 20][i] })) });

    const live = await as(s.admin).get(`/api/exams/sessions/${sess.id}/results/class`);
    expect(live.body.data.gradeScale.name).toBe("CBE Junior School (8-level)");
    expect(live.body.data.results.map((r) => r.overallGrade)).toEqual(["EE1", "ME1", "BE1"]);
    expect(live.body.data.results[0].subjectScores[0].grade).toBe("EE1");

    await as(s.teacher).post(`/api/exams/marksheets/${ms.id}/submit`).send({});
    await as(s.admin).post(`/api/exams/sessions/${sess.id}/publish`).send({});
    // Changing the scale afterwards doesn't touch published grades.
    await as(s.admin).put("/api/grade-scales/assign").send({ classIds: [s.klass.id], gradeScaleId: null });
    const frozen = await as(s.admin).get(`/api/exams/sessions/${sess.id}/results/class`);
    expect(frozen.body.data.results.map((r) => r.overallGrade)).toEqual(["EE1", "ME1", "BE1"]);
    expect(frozen.body.data.results[0].subjectScores[0].grade).toBe("EE1");
  });

  it("rejects broken bands and non-admins; school default applies to classes without one", async () => {
    const bad = await as(s.admin).post("/api/grade-scales").send({ name: "Bad", bands: [{ label: "A", minScore: 50, maxScore: 100 }, { label: "B", minScore: 0, maxScore: 40 }] });
    expect(bad.status).toBe(400);
    expect((await as(s.teacher).post("/api/grade-scales").send({ template: "KCSE" })).status).toBe(403);

    const k = (await as(s.admin).post("/api/grade-scales").send({ template: "KCSE" })).body.scale;
    expect((await as(s.admin).put("/api/grade-scales/default").send({ gradeScaleId: k.id })).status).toBe(200);
    const list = await as(s.teacher).get("/api/grade-scales");
    expect(list.body.defaultGradeScaleId).toBe(k.id);

    // Retiring it clears the default.
    await as(s.admin).delete(`/api/grade-scales/${k.id}`);
    expect((await as(s.admin).get("/api/grade-scales")).body.defaultGradeScaleId).toBeNull();
  });
});
