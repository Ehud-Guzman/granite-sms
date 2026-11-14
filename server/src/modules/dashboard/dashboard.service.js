// src/modules/dashboard/dashboard.service.js
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AttendanceSessionStatus, InvoiceStatus } from "@prisma/client";
import { getSchoolCalendar, localDayRange } from "../../utils/schoolTime.js";
import { localDaySql, utcSql } from "../../utils/sqlTime.js";
import { summaryKey, getCachedSummary, setCachedSummary, summaryGeneration } from "./summaryCache.js";

// Every "today" here is the school's local day (utils/schoolTime.js), not the
// server's or UTC's (audit 2, A2-DATA-04).

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

function classLabel(name, stream) {
  return `${name}${stream ? ` ${stream}` : ""}`;
}

/* =========================
   FEE FIGURES (fee roles only)
   =========================
   Three statements, all summed in Postgres (audit 2, A2-PERF-01: this used
   to load every payment of the last 14 days and add them up in JavaScript):
   money in per local day for 14 days (today's figures are its last day),
   invoice totals (outstanding overall, and this term's), and the six
   classes owing most this term. */
async function getFeeFigures({ schoolId, calendar }) {
  // The last 14 days in the school's own time zone, oldest first.
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(`${calendar.today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const span = localDayRange(days[0], days[days.length - 1], calendar.timezone);

  // This term's invoices (the whole year when no term is set), never VOID
  // ones. `t` is the table alias: "" or "i.". Values are cast to the column's
  // enum type (not the column to text) so Postgres can use its indexes.
  const termCond = (t = "") =>
    calendar.currentTerm
      ? Prisma.sql`${Prisma.raw(t)}"year" = ${calendar.currentYear} AND ${Prisma.raw(t)}"term" = ${calendar.currentTerm}::"Term"`
      : Prisma.sql`${Prisma.raw(t)}"year" = ${calendar.currentYear}`;
  const notVoid = (t = "") => Prisma.sql`${Prisma.raw(t)}"status" <> ${InvoiceStatus.VOID}::"InvoiceStatus"`;

  const [perDayRows, outstanding, [inv], owingRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT ${localDaySql('"receivedAt"', calendar.timezone)} AS "day",
             SUM("amount")::bigint AS "amount",
             COUNT(*)::int AS "receipts"
      FROM "FeePayment"
      WHERE "schoolId" = ${schoolId}
        AND "isReversed" = false
        AND "receivedAt" >= ${utcSql(span.from)}
        AND "receivedAt" <= ${utcSql(span.to)}
      GROUP BY 1`,
    // Everything still owed, any year (FeeInvoice(schoolId, balance) index).
    prisma.feeInvoice.aggregate({
      where: { schoolId, status: { not: InvoiceStatus.VOID }, balance: { gt: 0 } },
      _sum: { balance: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM("total"), 0)::bigint AS "termBilled",
        COALESCE(SUM("paid"), 0)::bigint AS "termPaid",
        COALESCE(SUM("balance"), 0)::bigint AS "termBalance",
        COUNT(*)::int AS "termInvoices",
        COUNT(*) FILTER (WHERE "balance" <= 0)::int AS "termFullyPaid"
      FROM "FeeInvoice"
      WHERE "schoolId" = ${schoolId} AND ${notVoid()} AND ${termCond()}`,
    prisma.$queryRaw`
      SELECT i."classId", c."name", c."stream",
             SUM(i."balance")::bigint AS "balance",
             SUM(i."total")::bigint AS "billed"
      FROM "FeeInvoice" i
      LEFT JOIN "Class" c ON c."id" = i."classId" AND c."schoolId" = i."schoolId"
      WHERE i."schoolId" = ${schoolId} AND ${notVoid("i.")} AND ${termCond("i.")}
      GROUP BY i."classId", c."name", c."stream"
      HAVING SUM(i."balance") > 0
      ORDER BY SUM(i."balance") DESC, i."classId"
      LIMIT 6`,
  ]);

  const perDay = new Map(perDayRows.map((r) => [r.day, r]));
  const trend = days.map((d) => ({
    date: d,
    amount: safeNum(perDay.get(d)?.amount),
    receipts: safeNum(perDay.get(d)?.receipts),
  }));
  const today = trend[trend.length - 1];

  const billed = safeNum(inv?.termBilled);
  const paid = safeNum(inv?.termPaid);

  return {
    collectedToday: today.amount,
    receiptsToday: today.receipts,
    outstandingTotal: safeNum(outstanding._sum.balance),
    invoicesCount: safeNum(outstanding._count._all),
    term: {
      year: calendar.currentYear,
      term: calendar.currentTerm || null,
      billed,
      paid,
      balance: safeNum(inv?.termBalance),
      invoices: safeNum(inv?.termInvoices),
      fullyPaid: safeNum(inv?.termFullyPaid),
      percent: billed ? Math.round((paid / billed) * 1000) / 10 : 0,
    },
    trend,
    byClass: owingRows.map((c) => ({
      classId: c.classId,
      label: c.name ? classLabel(c.name, c.stream) : "Class",
      balance: safeNum(c.balance),
      billed: safeNum(c.billed),
    })),
  };
}

/* =========================
   SUMMARY
   ========================= */
export async function getSummary(req) {
  const schoolId = requireSchoolOrThrow(req);
  const role = String(req.role || req.user?.role || "").toUpperCase();
  const teacherId = req.user?.teacherId || req.teacherId;

  const key = summaryKey({ schoolId, role, teacherId });
  const cached = getCachedSummary(key);
  if (cached) return cached;

  const generation = summaryGeneration(schoolId);
  return setCachedSummary(key, schoolId, await computeSummary({ schoolId, role, teacherId }), generation);
}

async function computeSummary({ schoolId, role, teacherId }) {
  // "Today" is the school's local day (Nairobi by default), not the UTC day.
  const calendar = await getSchoolCalendar(schoolId);
  const { from, to } = localDayRange(calendar.today, calendar.today, calendar.timezone);

  // A TEACHER sees only their own classes, as attendance.service.js and
  // exams.services.js scope every TEACHER read: the registers, today's
  // sessions and the latest exam session all come from those classes.
  const isTeacher = role === "TEACHER";
  const ownClasses = isTeacher ? { in: await getTeacherAssignedClassIds({ schoolId, teacherId }) } : undefined;

  // School finances are for those who run them (audit finding H6: teachers,
  // who are blocked from the Fees module, saw collections and arrears here).
  const canSeeFees = ["ADMIN", "BURSAR", "SYSTEM_ADMIN"].includes(role);

  const sessionsWhere = { schoolId, date: { gte: from, lte: to }, ...(ownClasses ? { classId: ownClasses } : {}) };

  const sessionsP = prisma.attendanceSession
    .findMany({
      where: sessionsWhere,
      select: { id: true, status: true, classId: true, takenByUserId: true, updatedAt: true, term: true, year: true },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => []);

  // Everything below is independent (the marks wait only for today's few
  // sessions): about two round trips' worth of waiting in all.
  const [studentsActive, classesCount, teachersCount, sessionsToday, scopeClasses, marks, latestExamSession, fees] =
    await Promise.all([
      prisma.student.count({ where: { schoolId, isActive: true } }),
      prisma.class.count({ where: { schoolId, isActive: true } }).catch(() => 0),
      prisma.teacher.count({ where: { schoolId } }).catch(() => 0),
      sessionsP,
      // Registers: which of the caller's classes are marked today, and how many came.
      prisma.class.findMany({
        where: { schoolId, isActive: true, ...(ownClasses ? { id: ownClasses } : {}) },
        select: { id: true, name: true, stream: true },
        orderBy: [{ name: "asc" }, { stream: "asc" }],
      }),
      // By session id (the AttendanceRecord(sessionId) index), not by a join
      // on the session, which made Postgres read every record the school has.
      sessionsP.then((sessions) =>
        sessions.length
          ? prisma.attendanceRecord.groupBy({
              by: ["status"],
              where: { schoolId, sessionId: { in: sessions.map((s) => s.id) }, status: { not: "UNMARKED" } },
              _count: { _all: true },
            })
          : []
      ),
      prisma.examSession
        .findFirst({
          where: { schoolId, ...(ownClasses ? { classId: ownClasses } : {}) },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, year: true, term: true, status: true, createdAt: true, classId: true },
        })
        .then((s) => s || null)
        .catch(() => null),
      canSeeFees ? getFeeFigures({ schoolId, calendar }) : null,
    ]);

  // --- Attendance today (based on session.date) ---
  let attendanceDraft = 0;
  let attendanceSubmitted = 0;
  let attendanceLocked = 0;
  for (const s of sessionsToday) {
    const st = mapAttendanceStatus(s.status);
    if (st === AttendanceSessionStatus.SUBMITTED) attendanceSubmitted += 1;
    else if (st === AttendanceSessionStatus.LOCKED) attendanceLocked += 1;
    else attendanceDraft += 1;
  }

  const doneIds = new Set(
    sessionsToday
      .filter((s) => [AttendanceSessionStatus.SUBMITTED, AttendanceSessionStatus.LOCKED].includes(mapAttendanceStatus(s.status)))
      .map((s) => s.classId)
  );
  const notMarked = scopeClasses
    .filter((c) => !doneIds.has(c.id))
    .map((c) => ({ classId: c.id, label: classLabel(c.name, c.stream) }));
  const markCount = Object.fromEntries(marks.map((m) => [m.status, m._count._all]));
  const marked = marks.reduce((n, m) => n + m._count._all, 0);
  const cameIn = (markCount.PRESENT || 0) + (markCount.LATE || 0);

  // --- Alerts (simple + useful) ---
  const alerts = {
    attendanceDraftSessionsToday: attendanceDraft,
    ...(fees ? { feesOutstandingTotal: fees.outstandingTotal, feesOutstandingInvoices: fees.invoicesCount } : {}),
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
    fees,
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
          actorUserId: null,
          actorName: r.receivedBy || null,
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
      ? `${(u.teacher?.firstName || "").trim()} ${(u.teacher?.lastName || "").trim()}`.trim() || u.email || u.id
      : x.actorName || null;

    return {
      ...x,
      actor: actor || (x.actorUserId ? String(x.actorUserId) : "System"),
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
