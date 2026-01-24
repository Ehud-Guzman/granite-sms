// src/modules/attendance/attendance.validators.js
import { AttendanceStatus, AttendanceSessionStatus, Term } from "@prisma/client";

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Expect "YYYY-MM-DD" only.
 * Returns a Date pinned to 00:00:00.000Z to avoid timezone drift.
 */
export function parseISODateOnly(dateStr) {
  if (!dateStr || typeof dateStr !== "string") {
    throw httpError("date is required and must be a string (YYYY-MM-DD).", 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw httpError("Invalid date format. Use YYYY-MM-DD.", 400);
  }

  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw httpError("Invalid date value.", 400);
  }

  return d;
}

export function assertTerm(term) {
  if (!term || !Object.values(Term).includes(term)) {
    throw httpError(`Invalid term. Allowed: ${Object.values(Term).join(", ")}`, 400);
  }
}

export function assertYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw httpError("Invalid year. Must be an integer between 2000 and 2100.", 400);
  }
  return y;
}

/**
 * Validates bulk records payload.
 * Rules:
 * - records must be a non-empty array
 * - status must be valid enum
 * - minutesLate is required only for LATE
 * - minutesLate must NOT be present for non-LATE (we normalize by rejecting noisy payloads)
 * - comment length cap to prevent abuse
 */
export function assertRecordsPayload(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw httpError("records must be a non-empty array.", 400);
  }

  for (const r of records) {
    if (!r || typeof r !== "object") {
      throw httpError("Each record must be an object.", 400);
    }

    if (!r.studentId || typeof r.studentId !== "string") {
      throw httpError("Each record must include studentId (string).", 400);
    }

    if (!r.status || !Object.values(AttendanceStatus).includes(r.status)) {
      throw httpError(
        `Invalid status for student ${r.studentId}. Allowed: ${Object.values(AttendanceStatus).join(", ")}`,
        400
      );
    }

    // comment sanity
    if (r.comment != null) {
      if (typeof r.comment !== "string") {
        throw httpError(`comment must be a string (${r.studentId}).`, 400);
      }
      if (r.comment.length > 250) {
        throw httpError(`comment too long (max 250 chars) (${r.studentId}).`, 400);
      }
    }

    // minutesLate rules
    if (r.status === "LATE") {
      if (r.minutesLate == null) {
        throw httpError(`minutesLate required when status is LATE (${r.studentId}).`, 400);
      }
      const m = Number(r.minutesLate);
      if (!Number.isInteger(m) || m < 0 || m > 600) {
        throw httpError(`minutesLate must be an integer between 0 and 600 (${r.studentId}).`, 400);
      }
    } else {
      // reject noisy payloads (or you can choose to ignore instead)
      if (r.minutesLate != null) {
        throw httpError(`minutesLate is only allowed when status is LATE (${r.studentId}).`, 400);
      }
    }
  }
}

/**
 * School-safe edit rules:
 * - DRAFT: editable
 * - SUBMITTED: read-only (Admin must unlock)
 * - LOCKED: read-only forever (unless you add an override route)
 */
export function ensureEditable(session) {
  if (!session) throw httpError("Session is required.", 500);

  if (session.status === AttendanceSessionStatus.LOCKED) {
    throw httpError("Attendance session is locked.", 409);
  }

  if (session.status === AttendanceSessionStatus.SUBMITTED) {
    throw httpError("Attendance session is submitted. Admin must unlock to edit.", 409);
  }
}

/**
 * Use this if you ever need to enforce "must be submitted"
 */
export function ensureSubmitted(session) {
  if (!session) throw httpError("Session is required.", 500);

  if (session.status !== AttendanceSessionStatus.SUBMITTED) {
    throw httpError("Attendance session must be submitted first.", 409);
  }
}
