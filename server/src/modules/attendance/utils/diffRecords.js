// src/features/attendance/utils/diffRecords.js

function normMinutesLate(status, minutesLate) {
  if (status === "LATE") return minutesLate ?? 0;
  return null;
}

function normComment(comment) {
  return comment ?? null;
}

export function getChangedAttendanceRecords(originalRecords = [], currentRecords = []) {
  const origByStudent = new Map(
    originalRecords.map((r) => [
      r.studentId,
      {
        status: r.status,
        minutesLate: normMinutesLate(r.status, r.minutesLate),
        comment: normComment(r.comment),
      },
    ])
  );

  const changed = [];

  for (const r of currentRecords) {
    const next = {
      status: r.status,
      minutesLate: normMinutesLate(r.status, r.minutesLate),
      comment: normComment(r.comment),
    };

    const prev = origByStudent.get(r.studentId);

    // if record didn’t exist before, it’s a change
    if (!prev) {
      changed.push({ studentId: r.studentId, ...next });
      continue;
    }

    const same =
      prev.status === next.status &&
      (prev.minutesLate ?? null) === (next.minutesLate ?? null) &&
      (prev.comment ?? null) === (next.comment ?? null);

    if (!same) changed.push({ studentId: r.studentId, ...next });
  }

  return changed;
}
