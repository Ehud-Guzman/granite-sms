// src/modules/exams/exams.grades.js
// Grading scales (audit H8). A school picks a default scale and any class can
// use its own, so CBE (Competency-Based Education, formerly CBC) classes get
// EE/ME/AE/BE rubric levels and 8-4-4 classes letter grades.
// Scales live in GradeScale/GradeBand; these templates are starting points the
// school edits. Check thresholds against current KNEC guidance before use.
import { prisma } from "../../lib/prisma.js";

// The built-in scale used when a school hasn't set one (unchanged behaviour).
export const DEFAULT_GRADE_BANDS = [
  { min: 80, grade: "A" },
  { min: 75, grade: "A-" },
  { min: 70, grade: "B+" },
  { min: 65, grade: "B" },
  { min: 60, grade: "B-" },
  { min: 55, grade: "C+" },
  { min: 50, grade: "C" },
  { min: 45, grade: "C-" },
  { min: 40, grade: "D+" },
  { min: 35, grade: "D" },
  { min: 30, grade: "D-" },
  { min: 0, grade: "E" },
];

const band = (label, minScore, maxScore, points, remark) => ({ label, minScore, maxScore, points, remark });

export const SCALE_TEMPLATES = {
  KCSE: {
    name: "KCSE (8-4-4)",
    overallBy: "POINTS",
    bands: [
      band("A", 80, 100, 12, "Excellent"),
      band("A-", 75, 79, 11, "Very good"),
      band("B+", 70, 74, 10, "Good"),
      band("B", 65, 69, 9, "Good"),
      band("B-", 60, 64, 8, "Fairly good"),
      band("C+", 55, 59, 7, "Average"),
      band("C", 50, 54, 6, "Average"),
      band("C-", 45, 49, 5, "Below average"),
      band("D+", 40, 44, 4, "Weak"),
      band("D", 35, 39, 3, "Weak"),
      band("D-", 30, 34, 2, "Very weak"),
      band("E", 0, 29, 1, "Poor"),
    ],
  },
  CBE_JSS: {
    name: "CBE Junior School (8-level)",
    overallBy: "AVERAGE",
    bands: [
      band("EE1", 90, 100, 8, "Exceeding expectations"),
      band("EE2", 75, 89, 7, "Exceeding expectations"),
      band("ME1", 58, 74, 6, "Meeting expectations"),
      band("ME2", 41, 57, 5, "Meeting expectations"),
      band("AE1", 31, 40, 4, "Approaching expectations"),
      band("AE2", 21, 30, 3, "Approaching expectations"),
      band("BE1", 11, 20, 2, "Below expectations"),
      band("BE2", 0, 10, 1, "Below expectations"),
    ],
  },
  CBE_PRIMARY: {
    name: "CBE Primary (4-level)",
    overallBy: "AVERAGE",
    bands: [
      band("EE", 75, 100, 4, "Exceeding expectations"),
      band("ME", 50, 74, 3, "Meeting expectations"),
      band("AE", 25, 49, 2, "Approaching expectations"),
      band("BE", 0, 24, 1, "Below expectations"),
    ],
  },
};

/**
 * Checks a set of bands: labels unique, each band min <= max, together they
 * cover 0..100 with no gaps or overlaps (whole marks). Returns an error or null.
 */
export function validateBands(bands) {
  if (!Array.isArray(bands) || bands.length < 2) return "A scale needs at least two bands.";
  const labels = new Set();
  for (const b of bands) {
    const label = String(b?.label || "").trim();
    if (!label || label.length > 12) return "Each band needs a short label (max 12 characters).";
    if (labels.has(label)) return `Label ${label} is used twice.`;
    labels.add(label);
    const min = Number(b.minScore);
    const max = Number(b.maxScore);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 100 || min > max) {
      return `${label}: marks must be whole numbers from 0 to 100, lowest first.`;
    }
    if (b.points != null && (!Number.isFinite(Number(b.points)) || Number(b.points) < 0)) return `${label}: points must be a number.`;
  }
  const sorted = [...bands].sort((a, b) => Number(a.minScore) - Number(b.minScore));
  if (Number(sorted[0].minScore) !== 0) return "The lowest band must start at 0.";
  if (Number(sorted[sorted.length - 1].maxScore) !== 100) return "The highest band must end at 100.";
  for (let i = 1; i < sorted.length; i++) {
    const prevMax = Number(sorted[i - 1].maxScore);
    const min = Number(sorted[i].minScore);
    if (min <= prevMax) return `${sorted[i - 1].label} and ${sorted[i].label} overlap.`;
    if (min !== prevMax + 1) return `Marks ${prevMax + 1}–${min - 1} are not in any band.`;
  }
  return null;
}

/**
 * A grader for a scale: grade(score) -> { label, points, remark } | null and
 * overall(scores[]) -> { grade, meanPoints }. Bands are matched on the mark
 * rounded to a whole number.
 */
export function makeGrader(scale) {
  const bands = scale?.bands?.length
    ? [...scale.bands].map((b) => ({ ...b, minScore: Number(b.minScore) })).sort((a, b) => b.minScore - a.minScore)
    : DEFAULT_GRADE_BANDS.map((b) => ({ label: b.grade, minScore: b.min, points: null, remark: null }));
  const overallBy = scale?.overallBy === "POINTS" && bands.every((b) => b.points != null) ? "POINTS" : "AVERAGE";

  function grade(score) {
    if (score === null || score === undefined || Number.isNaN(Number(score))) return null;
    const x = Math.max(0, Math.min(100, Math.round(Number(score))));
    const b = bands.find((bb) => x >= bb.minScore) || bands[bands.length - 1];
    return { label: b.label, points: b.points ?? null, remark: b.remark ?? null };
  }

  function overall(scores) {
    const valid = scores.filter((s) => s != null).map(Number);
    if (!valid.length) return { grade: null, meanPoints: null };
    if (overallBy === "POINTS") {
      const pts = valid.map((s) => grade(s).points);
      const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
      const rounded = Math.round(mean);
      const b = [...bands].sort((a, c) => Math.abs(a.points - rounded) - Math.abs(c.points - rounded))[0];
      return { grade: b.label, meanPoints: Number(mean.toFixed(2)) };
    }
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    return { grade: grade(avg).label, meanPoints: null };
  }

  return {
    scale: scale ? { id: scale.id ?? null, name: scale.name, overallBy } : { id: null, name: "Default (A–E)", overallBy },
    grade,
    overall,
  };
}

/** Old helper kept for callers that pass bands of { min, grade }. */
export function gradeFromScore(score, bands = DEFAULT_GRADE_BANDS) {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  const x = Math.max(0, Math.min(100, n));
  for (const b of bands) if (x >= b.min) return b.grade;
  return bands[bands.length - 1]?.grade ?? "E";
}

/** The grader for a class: its own scale, else the school default, else built-in. */
export async function graderForClass(db, { schoolId, classId }) {
  const klass = await (db || prisma).class.findFirst({ where: { id: classId, schoolId }, select: { gradeScaleId: true } });
  let scaleId = klass?.gradeScaleId || null;
  if (!scaleId) {
    const settings = await (db || prisma).schoolSettings.findUnique({ where: { schoolId }, select: { defaultGradeScaleId: true } });
    scaleId = settings?.defaultGradeScaleId || null;
  }
  if (!scaleId) return makeGrader(null);
  const scale = await (db || prisma).gradeScale.findFirst({
    where: { id: scaleId, schoolId, status: "ACTIVE" },
    include: { bands: true },
  });
  return makeGrader(scale);
}
