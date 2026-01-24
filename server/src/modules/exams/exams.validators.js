// src/modules/exams/exams.validators.js
import { Term, MarkSheetStatus, ExamSessionStatus } from "@prisma/client";

export function assertTerm(term) {
  if (!term || !Object.values(Term).includes(term)) {
    throw new Error(`Invalid term. Allowed: ${Object.values(Term).join(", ")}`);
  }
}

export function assertInt(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer.`);
  }
  return n;
}

// ✅ THIS WAS MISSING OR NOT EXPORTED
export function assertCuid(name, value) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
  // Loose validation: Prisma cuid is not UUID
  if (value.length < 10) {
    throw new Error(`${name} looks invalid.`);
  }
  return value;
}

export function assertMarkSheetEditable(status) {
  if (![MarkSheetStatus.DRAFT, MarkSheetStatus.UNLOCKED].includes(status)) {
    throw new Error("MarkSheet is not editable. Submit or unlock required.");
  }
}

export function assertNotPublished(sessionStatus) {
  if (sessionStatus === ExamSessionStatus.PUBLISHED) {
    throw new Error("ExamSession is already published.");
  }
}

export function validateBulkMarksPayload(body) {
  const marks = body?.marks;

  if (!Array.isArray(marks) || marks.length === 0) {
    throw new Error("marks[] is required.");
  }

  for (const row of marks) {
    if (!row?.studentId) {
      throw new Error("Each mark row must include studentId.");
    }

    if (row.score !== null && row.score !== undefined) {
      const s = Number(row.score);
      if (Number.isNaN(s)) {
        throw new Error("Score must be a number or null.");
      }
      if (s < 0 || s > 100) {
        throw new Error("Score must be between 0 and 100.");
      }
    }
  }

  return marks;
}
