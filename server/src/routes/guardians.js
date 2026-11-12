// src/routes/guardians.js
// Parents and guardians. Base path: /api/guardians
//
//   GET    /                      ADMIN, BURSAR   search guardians (?q= name or phone)
//   GET    /student/:studentId    ADMIN, BURSAR, TEACHER (own classes)
//   POST   /student/:studentId    ADMIN   add a guardian to a student (re-uses an
//                                          existing guardian with the same phone)
//   PATCH  /:id                   ADMIN   edit a guardian's details
//   PATCH  /links/:linkId         ADMIN   relationship / primary / receives SMS
//   DELETE /links/:linkId         ADMIN   unlink (guardian removed if no children left)
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { normalizePhone } from "../utils/phone.js";
import { teacherClassIds } from "../utils/teacherScope.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { queueSms, smsSettings, flushSoon } from "../modules/sms/sms.js";

const router = Router();
router.use(requireTenant);

const RELATIONSHIPS = ["MOTHER", "FATHER", "GUARDIAN", "SPONSOR", "OTHER"];

const str = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Validates guardian details. Returns { data } or { error }. partial = PATCH. */
function parseGuardian(body = {}, { partial = false } = {}) {
  const data = {};
  for (const k of ["firstName", "lastName"]) {
    if (!partial || k in body) {
      const v = str(body[k], 60);
      if (!v) return { error: `${k} is required` };
      data[k] = v;
    }
  }
  if (!partial || "phone" in body) {
    const phone = normalizePhone(body.phone);
    if (!phone) return { error: "phone must be a Kenyan mobile (07XX XXX XXX) or an international number starting with +" };
    data.phone = phone;
  }
  if ("email" in body) {
    const e = str(body.email, 120);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "email is not valid" };
    data.email = e ? e.toLowerCase() : null;
  }
  if ("nationalId" in body) data.nationalId = str(body.nationalId, 20);
  if ("occupation" in body) data.occupation = str(body.occupation, 80);
  return { data };
}

function parseRelationship(v) {
  const r = String(v || "GUARDIAN").trim().toUpperCase();
  return RELATIONSHIPS.includes(r) ? r : null;
}

const guardianSelect = {
  id: true,
  userId: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  nationalId: true,
  occupation: true,
};

/** The student, if the caller may see them (teachers: own classes only). */
async function findVisibleStudent(req, studentId) {
  const student = await prisma.student.findFirst({
    where: { id: String(studentId), schoolId: req.schoolId },
    select: { id: true, classId: true },
  });
  if (!student) return { status: 404, message: "Student not found" };
  if (req.role === "TEACHER") {
    const allowed = await teacherClassIds(req.schoolId, req.user?.teacherId);
    if (!allowed.includes(student.classId)) return { status: 403, message: "Forbidden: not your class" };
  }
  return { student };
}

async function listForStudent(schoolId, studentId) {
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, studentId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      relationship: true,
      isPrimary: true,
      receivesSms: true,
      guardian: {
        select: {
          ...guardianSelect,
          // Other children of the same guardian in this school (siblings).
          students: {
            where: { studentId: { not: studentId } },
            select: { student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } } },
          },
        },
      },
    },
  });
  return links.map((l) => ({
    linkId: l.id,
    relationship: l.relationship,
    isPrimary: l.isPrimary,
    receivesSms: l.receivesSms,
    guardian: { ...l.guardian, students: undefined },
    otherChildren: l.guardian.students.map((x) => x.student),
  }));
}

router.get("/", requireRole("ADMIN", "BURSAR"), async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  const phone = normalizePhone(q);
  const guardians = await prisma.guardian.findMany({
    where: {
      schoolId: req.schoolId,
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { phone: { contains: phone || q.replace(/\s/g, "") } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 50,
    select: {
      ...guardianSelect,
      students: {
        select: {
          relationship: true,
          isPrimary: true,
          student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, isActive: true } },
        },
      },
    },
  });
  return res.json({ guardians });
});

router.get("/student/:studentId", requireRole("ADMIN", "BURSAR", "TEACHER"), async (req, res) => {
  const found = await findVisibleStudent(req, req.params.studentId);
  if (!found.student) return res.status(found.status).json({ message: found.message });
  return res.json({ guardians: await listForStudent(req.schoolId, found.student.id) });
});

router.post("/student/:studentId", requireRole("ADMIN"), async (req, res) => {
  const found = await findVisibleStudent(req, req.params.studentId);
  if (!found.student) return res.status(found.status).json({ message: found.message });
  const studentId = found.student.id;

  const parsed = parseGuardian(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const relationship = parseRelationship(req.body?.relationship);
  if (!relationship) return res.status(400).json({ message: `relationship must be one of ${RELATIONSHIPS.join(", ")}` });

  const result = await prisma.$transaction(async (tx) => {
    // Same phone in this school = same person: link them, don't duplicate
    // (this is how siblings end up sharing a parent). Their existing details
    // are kept; edit them with PATCH /api/guardians/:id.
    let guardian = await tx.guardian.findUnique({
      where: { schoolId_phone: { schoolId: req.schoolId, phone: parsed.data.phone } },
      select: guardianSelect,
    });
    const linkedExisting = !!guardian;
    if (!guardian) {
      guardian = await tx.guardian.create({ data: { schoolId: req.schoolId, ...parsed.data }, select: guardianSelect });
    }

    const already = await tx.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
    });
    if (already) throw Object.assign(new Error("This guardian is already linked to this student."), { status: 409 });

    const hasPrimary = await tx.studentGuardian.count({ where: { studentId, isPrimary: true } });
    const isPrimary = req.body?.isPrimary === true || hasPrimary === 0;
    if (isPrimary) await tx.studentGuardian.updateMany({ where: { studentId }, data: { isPrimary: false } });

    const link = await tx.studentGuardian.create({
      data: {
        schoolId: req.schoolId,
        studentId,
        guardianId: guardian.id,
        relationship,
        isPrimary,
        receivesSms: req.body?.receivesSms !== false,
      },
    });
    return { guardian, link, linkedExisting };
  });

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "GUARDIAN_LINKED",
    targetType: "STUDENT",
    targetId: studentId,
    metadata: { guardianId: result.guardian.id, relationship, linkedExisting: result.linkedExisting },
  });

  return res.status(201).json({
    linkedExisting: result.linkedExisting,
    guardians: await listForStudent(req.schoolId, studentId),
  });
});

router.patch("/links/:linkId", requireRole("ADMIN"), async (req, res) => {
  const link = await prisma.studentGuardian.findFirst({
    where: { id: String(req.params.linkId), schoolId: req.schoolId },
  });
  if (!link) return res.status(404).json({ message: "Link not found" });

  const data = {};
  if ("relationship" in (req.body || {})) {
    const r = parseRelationship(req.body.relationship);
    if (!r) return res.status(400).json({ message: `relationship must be one of ${RELATIONSHIPS.join(", ")}` });
    data.relationship = r;
  }
  if ("receivesSms" in (req.body || {})) data.receivesSms = !!req.body.receivesSms;

  await prisma.$transaction(async (tx) => {
    if (req.body?.isPrimary === true) {
      await tx.studentGuardian.updateMany({ where: { studentId: link.studentId }, data: { isPrimary: false } });
      data.isPrimary = true;
    }
    await tx.studentGuardian.update({ where: { id: link.id }, data });
  });

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "GUARDIAN_LINK_UPDATED",
    targetType: "STUDENT",
    targetId: link.studentId,
    metadata: { linkId: link.id, ...data },
  });
  return res.json({ guardians: await listForStudent(req.schoolId, link.studentId) });
});

router.delete("/links/:linkId", requireRole("ADMIN"), async (req, res) => {
  const link = await prisma.studentGuardian.findFirst({
    where: { id: String(req.params.linkId), schoolId: req.schoolId },
  });
  if (!link) return res.status(404).json({ message: "Link not found" });

  await prisma.$transaction(async (tx) => {
    await tx.studentGuardian.delete({ where: { id: link.id } });
    // A guardian with no children left in the school isn't kept.
    const remaining = await tx.studentGuardian.count({ where: { guardianId: link.guardianId } });
    if (remaining === 0) await tx.guardian.delete({ where: { id: link.guardianId } });
    // Keep a primary contact if anyone is left.
    if (link.isPrimary) {
      const next = await tx.studentGuardian.findFirst({ where: { studentId: link.studentId }, orderBy: { createdAt: "asc" } });
      if (next) await tx.studentGuardian.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  });

  await logAudit({
    req,
    ...actorCtx(req),
    schoolId: req.schoolId,
    action: "GUARDIAN_UNLINKED",
    targetType: "STUDENT",
    targetId: link.studentId,
    metadata: { guardianId: link.guardianId },
  });
  return res.json({ guardians: await listForStudent(req.schoolId, link.studentId) });
});

/**
 * POST /api/guardians/:id/login  (ADMIN)
 * Gives a parent their own portal login (role PARENT). They sign in with
 * their email if they have one, otherwise their phone number. A temporary
 * password is returned once (and sent by SMS if the school has SMS on);
 * they must change it at first sign-in. { sendSms?: boolean }
 */
router.post("/:id/login", requireRole("ADMIN"), async (req, res) => {
  const g = await prisma.guardian.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId } });
  if (!g) return res.status(404).json({ message: "Guardian not found" });
  if (g.userId) return res.status(409).json({ message: "This parent already has a login. Reset its password from Settings > Users." });

  const loginId = g.email || g.phone;
  if (await prisma.user.findUnique({ where: { email: loginId } })) {
    return res.status(409).json({ message: `${loginId} is already used by another login.` });
  }
  const temp = crypto.randomBytes(9).toString("base64url").slice(0, 10) + "7a";
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email: loginId, password: await bcrypt.hash(temp, 10), role: "PARENT", schoolId: req.schoolId, isActive: true, mustChangePassword: true },
    });
    await tx.guardian.update({ where: { id: g.id }, data: { userId: u.id } });
    return u;
  });

  let smsQueued = false;
  if (req.body?.sendSms && (await smsSettings(prisma, req.schoolId))) {
    const school = await prisma.school.findUnique({ where: { id: req.schoolId }, select: { name: true, shortName: true } });
    await queueSms(prisma, {
      schoolId: req.schoolId,
      createdById: req.user.id,
      messages: [{ to: g.phone, guardianId: g.id, kind: "PARENT_LOGIN", body: `${school?.shortName || school?.name}: your parent login is ${loginId}, temporary password ${temp}. You will be asked to change it.` }],
    });
    flushSoon();
    smsQueued = true;
  }

  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "PARENT_LOGIN_CREATED", targetType: "USER", targetId: user.id, metadata: { guardianId: g.id, smsQueued } });
  return res.status(201).json({ loginId, tempPassword: temp, smsQueued });
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.guardian.findFirst({ where: { id: String(req.params.id), schoolId: req.schoolId } });
  if (!existing) return res.status(404).json({ message: "Guardian not found" });

  const parsed = parseGuardian(req.body, { partial: true });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  try {
    const guardian = await prisma.guardian.update({ where: { id: existing.id }, data: parsed.data, select: guardianSelect });
    await logAudit({
      req,
      ...actorCtx(req),
      schoolId: req.schoolId,
      action: "GUARDIAN_UPDATED",
      targetType: "GUARDIAN",
      targetId: existing.id,
      metadata: { changed: Object.keys(parsed.data) },
    });
    return res.json({ guardian });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Another guardian in this school already has that phone number." });
    }
    throw err;
  }
});

export default router;
