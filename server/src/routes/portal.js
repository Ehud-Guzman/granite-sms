// src/routes/portal.js
// Home for learners and parents (audit M15, missing feature 9). Base: /api/portal
//
//   GET  /learners                STUDENT, PARENT  one card per learner: fee account,
//                                                  latest published result, term attendance
//   POST /learners/:id/pay        PARENT           M-Pesa prompt to the parent's own phone
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { logAudit, actorCtx } from "../utils/audit.js";
import { ownLearnerIds } from "../utils/learnerAccess.js";
import { accountSummary } from "../modules/fees/ledger.js";
import { getSchoolCalendar } from "../utils/schoolTime.js";
import { stkPush } from "../modules/mpesa/daraja.js";
import { promptProblem } from "../modules/mpesa/promptGuard.js";
import { normalizeKenyanPhone } from "../utils/phone.js";

const router = Router();
router.use(requireTenant);

router.get("/learners", requireRole("STUDENT", "PARENT"), async (req, res) => {
  const ids = await ownLearnerIds(req);
  if (!ids.length) return res.json({ learners: [] });
  const cal = await getSchoolCalendar(req.schoolId);
  const students = await prisma.student.findMany({
    where: { schoolId: req.schoolId, id: { in: ids } },
    select: { id: true, admissionNo: true, firstName: true, lastName: true, isActive: true, class: { select: { name: true, stream: true, year: true } } },
    orderBy: { firstName: "asc" },
  });

  const learners = [];
  for (const st of students) {
    const [account, latest, att] = await Promise.all([
      accountSummary(prisma, { schoolId: req.schoolId, studentId: st.id }),
      prisma.studentResult.findFirst({
        where: { schoolId: req.schoolId, studentId: st.id },
        orderBy: { resultPublish: { publishedAt: "desc" } },
        select: {
          averageScore: true,
          overallGrade: true,
          position: true,
          resultPublish: { select: { publishedAt: true, examSession: { select: { id: true, name: true, year: true, term: true, _count: { select: { markSheets: true } } } }, _count: { select: { studentResults: true } } } },
        },
      }),
      prisma.attendanceRecord.groupBy({
        by: ["status"],
        where: { schoolId: req.schoolId, studentId: st.id, status: { not: "UNMARKED" }, session: { year: cal.currentYear, ...(cal.currentTerm ? { term: cal.currentTerm } : {}) } },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(att.map((a) => [a.status, a._count._all]));
    const total = att.reduce((s, a) => s + a._count._all, 0);
    learners.push({
      student: st,
      account,
      latestResult: latest && {
        sessionId: latest.resultPublish.examSession.id,
        exam: latest.resultPublish.examSession.name,
        year: latest.resultPublish.examSession.year,
        term: latest.resultPublish.examSession.term,
        average: latest.averageScore,
        grade: latest.overallGrade,
        position: latest.position,
        outOf: latest.resultPublish._count.studentResults,
        publishedAt: latest.resultPublish.publishedAt,
      },
      attendance: total
        ? { total, present: counts.PRESENT || 0, late: counts.LATE || 0, absent: counts.ABSENT || 0, ratePct: Math.round((((counts.PRESENT || 0) + (counts.LATE || 0)) / total) * 100) }
        : null,
    });
  }
  return res.json({ learners, calendar: { year: cal.currentYear, term: cal.currentTerm } });
});

router.post("/learners/:id/pay", requireRole("PARENT"), async (req, res) => {
  const ids = await ownLearnerIds(req);
  if (!ids.includes(String(req.params.id))) return res.status(403).json({ message: "Not your child." });
  const cfg = await prisma.mpesaConfig.findUnique({ where: { schoolId: req.schoolId } });
  if (!cfg?.isActive || !cfg.passkeyEnc) return res.status(400).json({ message: "The school hasn't set up M-Pesa payments here yet." });
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isInteger(amount) || amount < 10 || amount > 250000) return res.status(400).json({ message: "Enter an amount between 10 and 250,000." });

  const [student, guardian] = await Promise.all([
    prisma.student.findUnique({ where: { id: String(req.params.id) }, select: { id: true, admissionNo: true } }),
    prisma.guardian.findUnique({ where: { id: req.user.guardianId }, select: { phone: true } }),
  ]);
  const phone = normalizeKenyanPhone(req.body?.phone || guardian?.phone);
  if (!phone) return res.status(400).json({ message: "A Kenyan mobile number is needed for the prompt." });
  const blocked = await promptProblem({ schoolId: req.schoolId, studentId: student.id, phone });
  if (blocked) return res.status(blocked.status).json({ message: blocked.message });

  const r = await stkPush(cfg, { phone, amount, accountReference: student.admissionNo, description: "School fees" });
  await prisma.mpesaStkRequest.create({
    data: { schoolId: req.schoolId, checkoutRequestId: r.CheckoutRequestID, studentId: student.id, amount, phone, requestedById: req.user.id },
  });
  await logAudit({ req, ...actorCtx(req), schoolId: req.schoolId, action: "FEES_MPESA_STK_SENT", targetType: "STUDENT", targetId: student.id, metadata: { amount, byParent: true } });
  return res.json({ ok: true, message: "Check your phone and enter your M-Pesa PIN." });
});

export default router;
