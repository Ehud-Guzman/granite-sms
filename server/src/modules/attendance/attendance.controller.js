// src/modules/attendance/attendance.controller.js

import {
  upsertSessionAndEnsureRecords,
  getSessionWithRecords,
  bulkUpdateRecords,
  submitSession,
  unlockSession,
  lockSession,
  listSessions,
  summaryStudent,
  summaryClass,
  defaulters,
  assertTeacherAccessOrThrow,
} from "./attendance.service.js";

import {
  parseISODateOnly,
  assertTerm,
  assertYear,
  assertRecordsPayload,
} from "./attendance.validators.js";

/**
 * Normalize user id across token shapes.
 * Some systems set req.user.id, others set req.user.sub (JWT "subject").
 * We support both to avoid random "missing editedByUserId" failures.
 */
function getUserId(req) {
  return req.user?.id || req.user?.sub || null;
}

export async function createOrOpenSession(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const userId = getUserId(req);
    const role = req.user.role;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!userId) return res.status(401).json({ message: "Missing user id in token" });

    const { classId, date, year, term } = req.body;

    if (!classId) return res.status(400).json({ message: "classId is required" });

    const d = parseISODateOnly(date);
    const y = assertYear(year);
    assertTerm(term);

    // Teacher class access enforcement (ADMIN bypass)
    if (role === "TEACHER") {
      await assertTeacherAccessOrThrow({ schoolId, userId, classId });
    }

    const result = await upsertSessionAndEnsureRecords({
      schoolId,
      classId,
      date: d,
      year: y,
      term,
      takenByUserId: userId,
      role,
    });

    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function getSession(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.params.id;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });

    const session = await getSessionWithRecords({ schoolId, sessionId });
    return res.json(session);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function list(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const { classId, from, to } = req.query;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });

    const fromD = from ? parseISODateOnly(from) : null;
    const toD = to ? parseISODateOnly(to) : null;

    const sessions = await listSessions({ schoolId, classId, from: fromD, to: toD });
    return res.json(sessions);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function updateRecords(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const editorUserId = getUserId(req);
    const sessionId = req.params.id;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!editorUserId) return res.status(401).json({ message: "Missing user id in token" });

    const { records } = req.body;
    assertRecordsPayload(records);

    const session = await bulkUpdateRecords({ schoolId, sessionId, editorUserId, records });
    return res.json(session);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function submit(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const editorUserId = getUserId(req);
    const sessionId = req.params.id;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!editorUserId) return res.status(401).json({ message: "Missing user id in token" });

    const updated = await submitSession({ schoolId, sessionId, editorUserId });
    return res.json(updated);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function unlock(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const editorUserId = getUserId(req);
    const sessionId = req.params.id;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!editorUserId) return res.status(401).json({ message: "Missing user id in token" });

    const updated = await unlockSession({ schoolId, sessionId, editorUserId });
    return res.json(updated);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function lock(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const editorUserId = getUserId(req);
    const sessionId = req.params.id;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!editorUserId) return res.status(401).json({ message: "Missing user id in token" });

    const updated = await lockSession({ schoolId, sessionId, editorUserId });
    return res.json(updated);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function studentSummary(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const studentId = req.params.studentId;
    const { from, to } = req.query;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });

    const fromD = from ? parseISODateOnly(from) : null;
    const toD = to ? parseISODateOnly(to) : null;

    const data = await summaryStudent({ schoolId, studentId, from: fromD, to: toD });
    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function classSummary(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const classId = req.params.classId;
    const { from, to } = req.query;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });

    const fromD = from ? parseISODateOnly(from) : null;
    const toD = to ? parseISODateOnly(to) : null;

    const data = await summaryClass({ schoolId, classId, from: fromD, to: toD });
    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}

export async function defaultersList(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const { classId, from, to, minAbsences } = req.query;

    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });
    if (!classId) return res.status(400).json({ message: "classId is required" });

    const fromD = from ? parseISODateOnly(from) : null;
    const toD = to ? parseISODateOnly(to) : null;

    const data = await defaulters({
      schoolId,
      classId,
      from: fromD,
      to: toD,
      minAbsences: minAbsences ?? 5,
    });

    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }
}
