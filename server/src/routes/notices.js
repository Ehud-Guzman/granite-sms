// src/routes/notices.js
// The school noticeboard (audit missing feature 10). Base: /api/notices
//
//   GET    /       everyone in the school  notices meant for the caller
//                  (ADMIN gets every notice; ?all=1 adds expired ones)
//   POST   /       ADMIN   { title, body, audience, classIds?, pinned?, expiresOn?, sendSms? }
//   PATCH  /:id    ADMIN   same fields except sendSms (a notice is texted once)
//   DELETE /:id    ADMIN
//
// Staff see EVERYONE and STAFF notices. Learners and parents see EVERYONE and
// FAMILIES notices, the latter only for the whole school or their child's class.
import { Router } from "express";
import { NoticeAudience } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { isSelfService, ownLearnerIds } from "../utils/learnerAccess.js";
import { getSchoolCalendar, localDayRange, isDateString } from "../utils/schoolTime.js";
import { queueSms, familyRecipients, smsSettings, smsConfigured, flushSoon } from "../modules/sms/sms.js";

const router = Router();
router.use(requireTenant);

const AUDIENCES = Object.values(NoticeAudience);
const SMS_LIMIT = 400; // 3 SMS segments, with room for the school's name
const bad = (res, message) => res.status(400).json({ message });
const roleOf = (req) => req.role || req.user?.role;

const select = {
  id: true,
  title: true,
  body: true,
  audience: true,
  classIds: true,
  pinned: true,
  expiresAt: true,
  smsQueued: true,
  createdAt: true,
  updatedAt: true,
};

/** Checks and cleans the editable fields. Returns { data } or { error }. */
async function readNotice(req, { partial }) {
  const b = req.body || {};
  const data = {};

  if (!partial || "title" in b) {
    const title = String(b.title || "").trim();
    if (title.length < 3 || title.length > 120) return { error: "The title needs 3 to 120 characters." };
    data.title = title;
  }
  if (!partial || "body" in b) {
    const body = String(b.body || "").trim();
    if (!body || body.length > 4000) return { error: "Write the notice (up to 4,000 characters)." };
    data.body = body;
  }
  if (!partial || "audience" in b) {
    const audience = String(b.audience || "EVERYONE").toUpperCase();
    if (!AUDIENCES.includes(audience)) return { error: `audience must be one of: ${AUDIENCES.join(", ")}.` };
    data.audience = audience;
  }
  if ("classIds" in b) {
    if (!Array.isArray(b.classIds)) return { error: "classIds must be a list." };
    const ids = [...new Set(b.classIds.map(String))];
    if (ids.length) {
      const found = await prisma.class.count({ where: { schoolId: req.schoolId, id: { in: ids } } });
      if (found !== ids.length) return { error: "One of the classes isn't in this school." };
    }
    data.classIds = ids;
  }
  if ("pinned" in b) data.pinned = !!b.pinned;
  if ("expiresOn" in b) {
    if (b.expiresOn === null || b.expiresOn === "") data.expiresAt = null;
    else if (!isDateString(b.expiresOn)) return { error: "expiresOn must be a date (YYYY-MM-DD)." };
    else {
      // Shown until the end of that day in the school's time zone.
      const { timezone } = await getSchoolCalendar(req.schoolId);
      data.expiresAt = localDayRange(b.expiresOn, b.expiresOn, timezone).to;
    }
  }
  return { data };
}

/** Class ids only make sense for family notices. */
function normaliseAudience(data, current) {
  const audience = data.audience || current?.audience;
  if (audience && audience !== "FAMILIES") data.classIds = [];
}

function smsText(schoolName, notice) {
  const text = `${schoolName}: ${notice.title}. ${notice.body}`.replace(/\s+/g, " ");
  return text.length <= SMS_LIMIT ? text : `${text.slice(0, SMS_LIMIT - 30).trimEnd()}… More on the school portal.`;
}

router.get("/", async (req, res) => {
  const role = roleOf(req);
  const now = new Date();
  const showExpired = role === "ADMIN" || role === "SYSTEM_ADMIN" ? req.query.all === "1" : false;
  const where = { schoolId: req.schoolId, ...(showExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }) };

  if (isSelfService(req)) {
    const ids = await ownLearnerIds(req);
    const classes = ids.length
      ? (await prisma.student.findMany({ where: { schoolId: req.schoolId, id: { in: ids } }, select: { classId: true } }))
          .map((s) => s.classId)
          .filter(Boolean)
      : [];
    where.AND = [
      {
        OR: [
          { audience: "EVERYONE" },
          { audience: "FAMILIES", classIds: { isEmpty: true } },
          ...(classes.length ? [{ audience: "FAMILIES", classIds: { hasSome: classes } }] : []),
        ],
      },
    ];
  } else if (role !== "ADMIN" && role !== "SYSTEM_ADMIN") {
    where.audience = { in: ["EVERYONE", "STAFF"] };
  }

  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    (where.AND ||= []).push({
      OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }],
    });
  }

  // ?page=N: one page (pinned first, then newest) and the total, for the board.
  if (req.query.page !== undefined) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 50);
    const [notices, total] = await Promise.all([
      prisma.notice.findMany({
        where,
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select,
      }),
      prisma.notice.count({ where }),
    ]);
    return res.json({ notices, total, page, pageSize });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const notices = await prisma.notice.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: limit,
    select,
  });
  return res.json({ notices });
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { data, error } = await readNotice(req, { partial: false });
  if (error) return bad(res, error);
  normaliseAudience(data);

  const sendSms = req.body?.sendSms === true;
  if (sendSms) {
    if (data.audience === "STAFF") return bad(res, "Texts go to parents; staff notices can't be sent by SMS.");
    if (!(await smsSettings(prisma, req.schoolId))) {
      return res.status(400).json({ message: "SMS is switched off for this school (Settings > SMS).", code: "SMS_DISABLED" });
    }
  }

  const notice = await prisma.notice.create({ data: { ...data, schoolId: req.schoolId, createdById: req.user?.id || null }, select });

  let smsQueued = 0;
  if (sendSms) {
    const school = await prisma.school.findUnique({ where: { id: req.schoolId }, select: { name: true, shortName: true } });
    const body = smsText(school?.shortName || school?.name || "School", notice);
    const to = await familyRecipients(prisma, { schoolId: req.schoolId, classIds: notice.classIds });
    smsQueued = await queueSms(prisma, {
      schoolId: req.schoolId,
      createdById: req.user?.id || null,
      messages: to.map((t) => ({ to: t.phone, guardianId: t.guardianId, kind: "NOTICE", body })),
    });
    if (smsQueued) {
      await prisma.notice.update({ where: { id: notice.id }, data: { smsQueued } });
      flushSoon();
    }
  }

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "NOTICE_POSTED",
    targetType: "NOTICE",
    targetId: notice.id,
    metadata: { title: notice.title, audience: notice.audience, classIds: notice.classIds, smsQueued },
  });
  return res.status(201).json({ notice: { ...notice, smsQueued }, smsQueued, providerConfigured: smsConfigured() });
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const current = await prisma.notice.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId } });
  if (!current) return res.status(404).json({ message: "Notice not found." });
  const { data, error } = await readNotice(req, { partial: true });
  if (error) return bad(res, error);
  normaliseAudience(data, current);
  if (!Object.keys(data).length) return bad(res, "Nothing to change.");

  const notice = await prisma.notice.update({ where: { id: current.id }, data, select });
  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "NOTICE_UPDATED",
    targetType: "NOTICE",
    targetId: notice.id,
    metadata: { fields: Object.keys(data) },
  });
  return res.json({ notice });
});

router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const current = await prisma.notice.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId }, select: { id: true, title: true } });
  if (!current) return res.status(404).json({ message: "Notice not found." });
  await prisma.notice.delete({ where: { id: current.id } });
  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "NOTICE_DELETED",
    targetType: "NOTICE",
    targetId: current.id,
    metadata: { title: current.title },
  });
  return res.json({ ok: true });
});

export default router;
