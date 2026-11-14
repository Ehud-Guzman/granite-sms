// src/modules/timetable/timetable.routes.js
// /api/timetable
//
//   GET  /setup                         everyone in the school   bell times and days
//   PUT  /setup                         ADMIN   { days, periods, removeLessons? }
//   GET  /classes/:classId              ADMIN, TEACHER; STUDENT/PARENT their own class
//   PUT  /classes/:classId/slot         ADMIN   { day, periodId, subjectId|null, teacherId?, room? }
//   PUT  /classes/:classId/targets      ADMIN   { items: [{ assignmentId, lessonsPerWeek }] }
//   GET  /autofill?classId=&year=       ADMIN   preview (changes nothing)
//   POST /autofill                      ADMIN   { classIds?, year? } writes the preview
//   GET  /teachers/:teacherId           ADMIN any teacher; TEACHER only themselves
//   GET  /me                            teacher's week, or each learner's class week
//   GET  /today                         today's lessons for the caller
//   GET  /classes/:classId/pdf, /teachers/:teacherId/pdf   one-page A4 landscape
//
// Included on every plan. Changes are refused while the school's plan has
// lapsed (it stays readable), like every other module.
import { Router } from "express";

import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../middleware/auth.js";
import { requireTenant } from "../../middleware/tenant.js";
import { logAudit, actorCtx } from "../../utils/audit.js";
import { isSelfService, ownLearnerIds } from "../../utils/learnerAccess.js";
import { isLapsed } from "../../config/plans.js";
import * as svc from "./timetable.service.js";
import { drawTimetablePdf } from "./timetable.pdf.js";
import { loadLetterhead, safeFilePart } from "../print/pdfDocs.js";

const router = Router();
router.use(requireTenant);

const roleOf = (req) => req.role || req.user?.role;

/** Runs a handler and turns thrown { status, message, code } into a response. */
const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (!e.status) console.error("TIMETABLE ERROR:", e);
    res.status(e.status || 500).json({ message: e.status ? e.message : "Server error", ...(e.code ? { code: e.code } : {}), ...(e.lessons ? { lessons: e.lessons } : {}) });
  }
};

/** Refuses changes while the school's plan has lapsed (read-only). */
async function requireWritablePlan(req, res, next) {
  const sub = await prisma.subscription.findFirst({
    where: { schoolId: req.schoolId },
    orderBy: { createdAt: "desc" },
    select: { status: true, currentPeriodEnd: true },
  });
  if (sub && isLapsed(sub)) {
    return res.status(402).json({ message: "The school's plan has ended, so the timetable is read-only until it's renewed.", code: "SUBSCRIPTION_INACTIVE", mode: "READ_ONLY" });
  }
  next();
}

const audit = (req, action, targetId, metadata) =>
  logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action, targetType: "TIMETABLE", targetId, metadata }).catch(() => {});

/** Staff see any class; a learner or parent only their own learner's class. */
async function assertCanSeeClass(req, classId) {
  const role = roleOf(req);
  if (role === "ADMIN" || role === "TEACHER" || role === "SYSTEM_ADMIN") return;
  if (isSelfService(req)) {
    const ids = await ownLearnerIds(req);
    const n = ids.length ? await prisma.student.count({ where: { schoolId: req.schoolId, id: { in: ids }, classId: String(classId) } }) : 0;
    if (n) return;
  }
  throw Object.assign(new Error("You can't see this class's timetable."), { status: 403 });
}

/** ADMIN sees any teacher; a TEACHER only themselves. */
function assertCanSeeTeacher(req, teacherId) {
  const role = roleOf(req);
  if (role === "ADMIN" || role === "SYSTEM_ADMIN") return;
  if (role === "TEACHER" && req.user?.teacherId && req.user.teacherId === String(teacherId)) return;
  throw Object.assign(new Error("You can only see your own timetable."), { status: 403 });
}

// ---- Bell times ----
router.get("/setup", handle((req) => svc.getSetup(req.schoolId)));
router.put(
  "/setup",
  requireRole("ADMIN"),
  requireWritablePlan,
  handle(async (req) => {
    const out = await svc.saveSetup(req.schoolId, req.body, { removeLessons: req.body?.removeLessons === true });
    await audit(req, "TIMETABLE_SETUP_SAVED", req.schoolId, { days: out.days, periods: out.periods.length, removedLessons: out.removedLessons });
    return out;
  })
);

// ---- A class's week ----
router.get(
  "/classes/:classId",
  handle(async (req) => {
    await assertCanSeeClass(req, req.params.classId);
    const t = await svc.getClassTimetable(req.schoolId, req.params.classId);
    // Learners and parents get the week, not the planning details.
    if (isSelfService(req)) {
      const { load, warnings, ...rest } = t; // eslint-disable-line no-unused-vars
      return rest;
    }
    return t;
  })
);
router.put(
  "/classes/:classId/slot",
  requireRole("ADMIN"),
  requireWritablePlan,
  handle(async (req) => {
    const out = await svc.setSlot(req.schoolId, req.params.classId, req.body || {});
    await audit(req, out.cleared ? "TIMETABLE_SLOT_CLEARED" : "TIMETABLE_SLOT_SET", req.params.classId, {
      day: req.body?.day,
      periodId: req.body?.periodId,
      subjectId: req.body?.subjectId || null,
      teacherId: out.lesson?.teacherId || null,
    });
    return out;
  })
);
router.put(
  "/classes/:classId/targets",
  requireRole("ADMIN"),
  requireWritablePlan,
  handle((req) => svc.setTargets(req.schoolId, req.params.classId, req.body?.items))
);

// ---- Auto-fill ----
const autofillArgs = (src) => ({
  classIds: src.classId ? [String(src.classId)] : Array.isArray(src.classIds) ? src.classIds.map(String) : [],
  year: src.year ? Number(src.year) : undefined,
});
router.get("/autofill", requireRole("ADMIN"), handle((req) => svc.autofill(req.schoolId, { ...autofillArgs(req.query), apply: false })));
router.post(
  "/autofill",
  requireRole("ADMIN"),
  requireWritablePlan,
  handle(async (req) => {
    const out = await svc.autofill(req.schoolId, { ...autofillArgs(req.body || {}), apply: true });
    await audit(req, "TIMETABLE_AUTOFILLED", req.schoolId, { year: out.year, placed: out.placed, classes: out.classes.length });
    return out;
  })
);

// ---- Teachers, me, today ----
router.get(
  "/teachers/:teacherId",
  requireRole("ADMIN", "TEACHER", "SYSTEM_ADMIN"),
  handle(async (req) => {
    assertCanSeeTeacher(req, req.params.teacherId);
    return svc.getTeacherTimetable(req.schoolId, req.params.teacherId, { year: req.query.year });
  })
);
router.get(
  "/me",
  handle(async (req) =>
    svc.getMine(req.schoolId, {
      role: roleOf(req),
      teacherId: req.user?.teacherId || null,
      studentIds: isSelfService(req) ? await ownLearnerIds(req) : [],
    })
  )
);
router.get(
  "/today",
  handle(async (req) =>
    svc.getToday(req.schoolId, {
      role: roleOf(req),
      teacherId: req.user?.teacherId || null,
      studentIds: isSelfService(req) ? await ownLearnerIds(req) : [],
    })
  )
);

// ---- PDFs ----
router.get(
  "/classes/:classId/pdf",
  handle(async (req, res) => {
    await assertCanSeeClass(req, req.params.classId);
    const t = await svc.getClassTimetable(req.schoolId, req.params.classId);
    const lh = await loadLetterhead(req.schoolId);
    drawTimetablePdf(res, lh, {
      filename: `timetable-${safeFilePart(t.class.label)}-${t.class.year}.pdf`,
      title: `${t.class.label} timetable`,
      subtitle: String(t.class.year),
      setup: t,
      lessons: t.lessons,
      cell: (l) => [l.subject?.name, [l.teacher?.name, l.room].filter(Boolean).join(" · ")],
    });
  })
);
router.get(
  "/teachers/:teacherId/pdf",
  requireRole("ADMIN", "TEACHER", "SYSTEM_ADMIN"),
  handle(async (req, res) => {
    assertCanSeeTeacher(req, req.params.teacherId);
    const t = await svc.getTeacherTimetable(req.schoolId, req.params.teacherId, { year: req.query.year });
    const lh = await loadLetterhead(req.schoolId);
    drawTimetablePdf(res, lh, {
      filename: `timetable-${safeFilePart(t.teacher.name)}-${t.year}.pdf`,
      title: `${t.teacher.name}: teaching timetable`,
      subtitle: `${t.year} · ${t.totals.week} lesson${t.totals.week === 1 ? "" : "s"} a week`,
      setup: t,
      lessons: t.lessons,
      cell: (l) => [l.class?.label, [l.subject?.name, l.room].filter(Boolean).join(" · ")],
    });
  })
);

export default router;
