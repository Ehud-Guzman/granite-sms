// src/modules/dashboard/dashboard.service.js
import { prisma } from "../../lib/prisma.js";
import { AttendanceSessionStatus, InvoiceStatus } from "@prisma/client";
import { getSchoolCalendar, localDayRange, localDateString } from "../../utils/schoolTime.js";

/* =========================
   Time helpers (UTC-day window)
   ========================= */
function startOfDayUTC(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDayUTC(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function actorLabelFromReq(req) {
  return req.user?.id || req.user?.sub || null;
}

function requireSchoolOrThrow(req) {
  // tenantContext (now mounted ahead of every route in this router) is the
  // sole source of truth for req.schoolId — it verifies the user's school
  // membership against the DB. Do NOT fall back to the raw x-school-id
  // header or the JWT-embedded schoolId here: neither is verified against
  // the caller's actual tenant, and trusting them would let any
  // authenticated user view another school's dashboard by just setting a
  // header.
  const schoolId = req.schoolId;

  if (!schoolId) {
    const err = new Error("No school selected/attached to this user.");
    err.statusCode = 400;
    throw err;
  }
  return schoolId;
}

// All classIds a teacher currently has some claim to (class-teacher OR
// active teaching assignment), tenant-scoped. Mirrors
// attendance.service.js#getTeacherAssignedClassIds / exams.services.js
// #getTeacherAssignedClassIds — used to scope the attendance-edit activity
// feed to a TEACHER's own classes instead of the whole school
// (attendance.routes.js has no endpoint that exposes this log to TEACHER at
// all, and every other attendance read endpoint scopes TEACHER callers to
// their assigned classes). Takes teacherId directly (tenantContext already
// resolves and attaches req.user.teacherId, so no extra lookup is needed).
async function getTeacherAssignedClassIds({ schoolId, teacherId }) {
  if (!teacherId) return [];

  const [classTeacherRows, assignmentRows] = await Promise.all([
    prisma.classTeacher.findMany({
      where: { schoolId, teacherId, isActive: true },
      select: { classId: true },
    }),
    prisma.teachingAssignment.findMany({
      where: { schoolId, teacherId, isActive: true },
      select: { classId: true },
    }),
  ]);

  return [
    ...new Set([
      ...classTeacherRows.map((r) => r.classId),
      ...assignmentRows.map((r) => r.classId),
    ]),
  ];
}


function mapAttendanceStatus(st) {
  const s = String(st || "").toUpperCase();
  // legacy support
  if (s === "OPEN") return "DRAFT";
  return s || "DRAFT";
}

/* =========================
   SUMMARY
   ========================= */
export async function getSummary(req) {
  const schoolId = requireSchoolOrThrow(req);

  // "Today" is the school's local day (Nairobi by default), not the UTC day.
  const calendar = await getSchoolCalendar(schoolId);
  const { from, to } = localDayRange(calendar.today, calendar.today, calendar.timezone);

  // --- Core counts ---
  const [studentsActive, classesCount, teachersCount] = await Promise.all([
    prisma.student.count({ where: { schoolId, isActive: true } }),
    prisma.class.count({ where: { schoolId, isActive: true } }).catch(() => 0),
    prisma.teacher.count({ where: { schoolId } }).catch(() => 0),
  ]);

  // --- Attendance today (based on session.date) ---
  // attendance.service.js scopes every TEACHER read (list/get/summary) to
  // their own assigned classes; do the same here so a TEACHER's "Attendance
  // Today" widget doesn't surface other classes' session status/takenByUserId.
  const summaryRole = String(req.role || req.user?.role || "").toUpperCase();
  let sessionsWhere = { schoolId, date: { gte: from, lte: to } };
  if (summaryRole === "TEACHER") {
    const assignedClassIds = await getTeacherAssignedClassIds({
      schoolId,
      teacherId: req.user?.teacherId || req.teacherId,
    });
    sessionsWhere = { ...sessionsWhere, classId: { in: assignedClassIds } };
  }

  const sessionsToday = await prisma.attendanceSession
    .findMany({
      where: sessionsWhere,
      select: { id: true, status: true, classId: true, takenByUserId: true, updatedAt: true, term: true, year: true },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => []);

  let attendanceDraft = 0;
  let attendanceSubmitted = 0;
  let attendanceLocked = 0;

  for (const s of sessionsToday) {
    const st = mapAttendanceStatus(s.status);
    if (st === AttendanceSessionStatus.DRAFT) attendanceDraft += 1;
    else if (st === AttendanceSessionStatus.SUBMITTED) attendanceSubmitted += 1;
    else if (st === AttendanceSessionStatus.LOCKED) attendanceLocked += 1;
    else attendanceDraft += 1;
  }

  // School finances are for those who run them (audit finding H6: teachers,
  // who are blocked from the Fees module, saw collections and arrears here).
  const canSeeFees = ["ADMIN", "BURSAR", "SYSTEM_ADMIN"].includes(summaryRole);

  // --- Fees collected today (use receivedAt + exclude reversals) ---
  let feesCollectedToday = 0;
  let feesReceiptsToday = 0;

  if (canSeeFees) try {
    const agg = await prisma.feePayment.aggregate({
      where: {
        schoolId,
        receivedAt: { gte: from, lte: to },
        isReversed: false,
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    feesCollectedToday = safeNum(agg?._sum?.amount);
    feesReceiptsToday = safeNum(agg?._count?._all);
  } catch {
    // If your prisma model differs, keep zeros (but summary won't crash)
    feesCollectedToday = 0;
    feesReceiptsToday = 0;
  }

  // --- Outstanding invoices (exclude VOID) ---
  let feeOutstandingTotal = 0;
  let feeInvoicesCount = 0;

  if (canSeeFees) try {
    const agg = await prisma.feeInvoice.aggregate({
      where: {
        schoolId,
        status: { not: InvoiceStatus.VOID },
        balance: { gt: 0 },
      },
      _sum: { balance: true },
      _count: { _all: true },
    });

    feeOutstandingTotal = safeNum(agg?._sum?.balance);
    feeInvoicesCount = safeNum(agg?._count?._all);
  } catch {
    feeOutstandingTotal = 0;
    feeInvoicesCount = 0;
  }

  // --- This term's fees, the last 14 days of collections, arrears by class ---
  let feesTerm = null;
  let feesTrend = [];
  let feesByClass = [];
  if (canSeeFees) {
    const termWhere = {
      schoolId,
      year: calendar.currentYear,
      ...(calendar.currentTerm ? { term: calendar.currentTerm } : {}),
      status: { not: InvoiceStatus.VOID },
    };
    const [termAgg, fullyPaid, perClass] = await Promise.all([
      prisma.feeInvoice.aggregate({ where: termWhere, _sum: { total: true, paid: true, balance: true }, _count: { _all: true } }),
      prisma.feeInvoice.count({ where: { ...termWhere, balance: { lte: 0 } } }),
      prisma.feeInvoice.groupBy({ by: ["classId"], where: termWhere, _sum: { total: true, balance: true } }),
    ]);
    const billed = safeNum(termAgg._sum.total);
    const paid = safeNum(termAgg._sum.paid);
    feesTerm = {
      year: calendar.currentYear,
      term: calendar.currentTerm || null,
      billed,
      paid,
      balance: safeNum(termAgg._sum.balance),
      invoices: safeNum(termAgg._count._all),
      fullyPaid,
      percent: billed ? Math.round((paid / billed) * 1000) / 10 : 0,
    };

    // Day by day in the school's own time zone, oldest first.
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(`${calendar.today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const span = localDayRange(days[0], days[days.length - 1], calendar.timezone);
    const recent = await prisma.feePayment.findMany({
      where: { schoolId, isReversed: false, receivedAt: { gte: span.from, lte: span.to } },
      select: { amount: true, receivedAt: true },
    });
    const perDay = new Map(days.map((d) => [d, { date: d, amount: 0, receipts: 0 }]));
    for (const p of recent) {
      const key = localDateString(p.receivedAt, calendar.timezone);
      const x = perDay.get(key);
      if (x) {
        x.amount += safeNum(p.amount);
        x.receipts += 1;
      }
    }
    feesTrend = [...perDay.values()];

    const owing = perClass.filter((c) => safeNum(c._sum.balance) > 0);
    const names = owing.length
      ? await prisma.class.findMany({ where: { schoolId, id: { in: owing.map((c) => c.classId) } }, select: { id: true, name: true, stream: true } })
      : [];
    const nameOf = new Map(names.map((c) => [c.id, `${c.name}${c.stream ? ` ${c.stream}` : ""}`]));
    feesByClass = owing
      .map((c) => ({ classId: c.classId, label: nameOf.get(c.classId) || "Class", balance: safeNum(c._sum.balance), billed: safeNum(c._sum.total) }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6);
  }

  // --- Registers: which of the caller's classes are marked today, and how many came ---
  const classScope = { schoolId, isActive: true };
  if (summaryRole === "TEACHER") {
    classScope.id = { in: await getTeacherAssignedClassIds({ schoolId, teacherId: req.user?.teacherId || req.teacherId }) };
  }
  const scopeClasses = await prisma.class.findMany({
    where: classScope,
    select: { id: true, name: true, stream: true },
    orderBy: [{ name: "asc" }, { stream: "asc" }],
  });
  const doneIds = new Set(
    sessionsToday
      .filter((s) => [AttendanceSessionStatus.SUBMITTED, AttendanceSessionStatus.LOCKED].includes(mapAttendanceStatus(s.status)))
      .map((s) => s.classId)
  );
  const notMarked = scopeClasses
    .filter((c) => !doneIds.has(c.id))
    .map((c) => ({ classId: c.id, label: `${c.name}${c.stream ? ` ${c.stream}` : ""}` }));
  const marks = sessionsToday.length
    ? await prisma.attendanceRecord.groupBy({
        by: ["status"],
        where: { schoolId, sessionId: { in: sessionsToday.map((s) => s.id) }, status: { not: "UNMARKED" } },
        _count: { _all: true },
      })
    : [];
  const markCount = Object.fromEntries(marks.map((m) => [m.status, m._count._all]));
  const marked = marks.reduce((n, m) => n + m._count._all, 0);
  const cameIn = (markCount.PRESENT || 0) + (markCount.LATE || 0);

  // --- Latest exam session (real model) ---
  // exams.services.js#listExamSessions scopes TEACHER callers to their
  // assigned classes only; mirror that here so a TEACHER's "Latest Exam
  // Session" widget can't surface a session for a class they don't teach.
  let latestExamSession = null;
  try {
    const examSessionWhere = { schoolId };
    if (summaryRole === "TEACHER") {
      const assignedClassIds = await getTeacherAssignedClassIds({
        schoolId,
        teacherId: req.user?.teacherId || req.teacherId,
      });
      examSessionWhere.classId = { in: assignedClassIds };
    }

    const ses = await prisma.examSession.findFirst({
      where: examSessionWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        year: true,
        term: true,
        status: true,
        createdAt: true,
        classId: true,
      },
    });
    latestExamSession = ses || null;
  } catch {
    latestExamSession = null;
  }

  // --- Alerts (simple + useful) ---
  const alerts = {
    attendanceDraftSessionsToday: attendanceDraft,
    ...(canSeeFees
      ? { feesOutstandingTotal: feeOutstandingTotal, feesOutstandingInvoices: feeInvoicesCount }
      : {}),
  };

  return {
    meta: {
      computedAt: new Date().toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
    },
    counts: {
      studentsActive,
      classesCount,
      teachersCount,
    },
    attendanceToday: {
      total: sessionsToday.length,
      draft: attendanceDraft,
      submitted: attendanceSubmitted,
      locked: attendanceLocked,
      recentSessions: sessionsToday.slice(0, 5),
      classes: scopeClasses.length,
      registersDone: scopeClasses.length - notMarked.length,
      notMarked: notMarked.slice(0, 12),
      marked,
      present: markCount.PRESENT || 0,
      late: markCount.LATE || 0,
      absent: markCount.ABSENT || 0,
      ratePct: marked ? Math.round((cameIn / marked) * 100) : null,
    },
    calendar: { year: calendar.currentYear, term: calendar.currentTerm || null, today: calendar.today },
    fees: canSeeFees
      ? {
          collectedToday: feesCollectedToday,
          receiptsToday: feesReceiptsToday,
          outstandingTotal: feeOutstandingTotal,
          invoicesCount: feeInvoicesCount,
          term: feesTerm,
          trend: feesTrend,
          byClass: feesByClass,
        }
      : null,
    exams: {
      latestSession: latestExamSession,
    },
    alerts,
  };
}

/* =========================
   ACTIVITY FEED
   ========================= */
export async function getActivity(req) {
  const schoolId = requireSchoolOrThrow(req);
  const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50);

  const items = [];
  const activityRole = String(req.role || req.user?.role || "").toUpperCase();

  // 1) Attendance edit logs — attendance.service.js scopes every TEACHER
  // read to their own assigned classes (assertTeacherAccessOrThrow /
  // getTeacherAssignedClassIds), and there's no attendance route that
  // exposes this raw edit log to TEACHER at all. Mirror that scoping here
  // instead of showing a TEACHER edit diffs for classes they don't teach.
  let attendanceWhere = { schoolId };
  if (activityRole === "TEACHER") {
    const assignedClassIds = await getTeacherAssignedClassIds({
      schoolId,
      teacherId: req.user?.teacherId || req.teacherId,
    });
    attendanceWhere = { schoolId, session: { classId: { in: assignedClassIds } } };
  }

  try {
    const rows = await prisma.attendanceEditLog.findMany({
      where: attendanceWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        sessionId: true,
        recordId: true,
        action: true,
        editedByUserId: true,
        before: true,
        after: true,
      },
    });

    for (const r of rows) {
      items.push({
        id: `att_${r.id}`,
        at: r.createdAt,
        module: "ATTENDANCE",
        action: r.action,
        actorUserId: r.editedByUserId || null,
        entity: { sessionId: r.sessionId, recordId: r.recordId },
        meta: { before: r.before, after: r.after },
      });
    }
  } catch {
    // ignore
  }

  // 2) Fees activity (payments) — the fees module itself restricts payment
  // records to ADMIN/BURSAR (and STUDENT for their own), so mirror that gate
  // here instead of leaking itemized receipt numbers/amounts to any TEACHER
  // who happens to have dashboard access.
  if (["ADMIN", "SYSTEM_ADMIN", "BURSAR"].includes(activityRole)) {
    try {
      const rows = await prisma.feePayment.findMany({
        where: { schoolId, isReversed: false },
        orderBy: { receivedAt: "desc" },
        take: limit,
        // FeePayment has no user-id column; receivedBy is a free-text name.
        // (Selecting fields that don't exist used to throw here, and the catch
        // below silently dropped every payment from the feed.)
        select: {
          id: true,
          receivedAt: true,
          amount: true,
          receiptNo: true,
          method: true,
          receivedBy: true,
        },
      });

      for (const r of rows) {
        items.push({
          id: `fee_${r.id}`,
          at: r.receivedAt,
          module: "FEES",
          action: "PAYMENT_RECEIVED",
          // receivedBy is the cashier's user id: named below like every other actor.
          actorUserId: r.receivedBy || null,
          actorName: null,
          entity: { receiptNo: r.receiptNo || null },
          meta: { amount: r.amount, method: r.method },
        });
      }
    } catch {
      // ignore
    }
  }

  // 3) Exams activity (audit log — premium). This is a raw cross-class audit
  // trail (unlock reasons, publish/submit events for every class in the
  // school, entity types that don't all carry a classId) with no equivalent
  // TEACHER-facing route in exams.routes.js, so — like the fees ledger above
  // — keep it to roles that have oversight over the whole school rather than
  // exposing every other teacher's class activity here.
  if (["ADMIN", "SYSTEM_ADMIN"].includes(activityRole)) {
    try {
      const rows = await prisma.examAuditLog.findMany({
        where: { schoolId },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 30),
        select: {
          id: true,
          createdAt: true,
          action: true,
          entityType: true,
          entityId: true,
          actorUserId: true,
          after: true,
        },
      });

      for (const r of rows) {
        items.push({
          id: `exlog_${r.id}`,
          at: r.createdAt,
          module: "EXAMS",
          action: r.action,
          actorUserId: r.actorUserId || null,
          entity: { type: r.entityType, id: r.entityId },
          meta: r.after ?? null,
        });
      }
    } catch {
      // ignore
    }
  }

  // Unified sort newest-first
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const sliced = items.slice(0, limit);

  // Actor enrichment (names)
  const actorIds = Array.from(new Set(sliced.map((x) => x.actorUserId).filter(Boolean)));
  let usersById = new Map();

  if (actorIds.length) {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: actorIds } },
        // User has no name columns; a teacher's name lives on Teacher.
        select: {
          id: true,
          email: true,
          role: true,
          teacher: { select: { firstName: true, lastName: true } },
        },
      });
      usersById = new Map(users.map((u) => [u.id, u]));
    } catch {
      // ignore
    }
  }

  const enriched = sliced.map((x) => {
    const u = x.actorUserId ? usersById.get(x.actorUserId) : null;
    const actor = u
      ? `${(u.teacher?.firstName || "").trim()} ${(u.teacher?.lastName || "").trim()}`.trim() || u.email || "A staff member"
      : x.actorName || null;

    return {
      ...x,
      actor: actor || (x.actorUserId ? "A staff member" : "System"),
      actorRole: u?.role || null,
    };
  });

  return {
    meta: { computedAt: new Date().toISOString(), limit },
    items: enriched,
    viewer: {
      userId: actorLabelFromReq(req),
      schoolId,
    },
  };
}
