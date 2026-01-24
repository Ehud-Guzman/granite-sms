// src/modules/exams/exams.grades.js

// Default bands (edit later without touching results logic)
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

// score can be null
export function gradeFromScore(score, bands = DEFAULT_GRADE_BANDS) {
  if (score === null || score === undefined) return null;

  const n = Number(score);
  if (Number.isNaN(n)) return null;

  // Clamp 0..100 (you can remove clamp later if you support >100)
  const x = Math.max(0, Math.min(100, n));

  for (const b of bands) {
    if (x >= b.min) return b.grade;
  }
  return bands[bands.length - 1]?.grade ?? "E";
}
