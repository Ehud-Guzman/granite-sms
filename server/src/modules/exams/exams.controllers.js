// src/modules/exams/exams.controllers.js
import * as svc from "./exams.services.js";
import * as reportCards from "./reportCards.js";
import { prisma } from "../../lib/prisma.js";
import { accountSummary } from "../fees/ledger.js";
import { loadLetterhead, startPdf, drawResultSlip, drawReportCard, safeFilePart } from "../print/pdfDocs.js";

export async function wrap(req, res, fn) {
  try {
    const data = await fn(req);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.statusCode || 400).json({ success: false, message: e.message || "Request failed" });
  }
}

export const listExamTypes = (req, res) => wrap(req, res, svc.listExamTypes);
export const createExamType = (req, res) => wrap(req, res, svc.createExamType);

export const listExamSessions = (req, res) => wrap(req, res, svc.listExamSessions);
export const createExamSession = (req, res) => wrap(req, res, svc.createExamSession);

export const listSessionMarkSheets = (req, res) => wrap(req, res, svc.listSessionMarkSheets);


export const getMarkSheet = (req, res) => wrap(req, res, svc.getMarkSheet);
export const upsertBulkMarks = (req, res) => wrap(req, res, svc.upsertBulkMarks);
export const submitMarkSheet = (req, res) => wrap(req, res, svc.submitMarkSheet);
export const unlockMarkSheet = (req, res) => wrap(req, res, svc.unlockMarkSheet);

export const publishResults = (req, res) => wrap(req, res, svc.publishResults);
export const unpublishResults = (req, res) => wrap(req, res, svc.unpublishResults);

export const getClassReportCards = (req, res) => wrap(req, res, reportCards.getClassReportCards);
export const getStudentReportCard = (req, res) => wrap(req, res, reportCards.getStudentReportCard);
export const saveReportComment = (req, res) => wrap(req, res, reportCards.saveReportComment);
export const getClassResults = (req, res) => wrap(req, res, svc.getClassResults);
export const getStudentResults = (req, res) => wrap(req, res, svc.getStudentResults);
// ------------------------
// PDF downloads (one A4 page on the school's letterhead). Same access as the
// JSON reads they are built from.
// ------------------------

/** The family's fee balance, only when the school prints it on reports. */
async function feeExtras(schoolId, lh, studentId) {
  if (!lh.style.show.feeBalance || !studentId) return {};
  const { net } = await accountSummary(prisma, { schoolId, studentId });
  return { feeBalance: net };
}

async function pdfOrError(res, build) {
  try {
    await build();
  } catch (e) {
    if (!res.headersSent) res.status(e.statusCode || 400).json({ success: false, message: e.message || "Request failed" });
    else res.end();
  }
}

export const getStudentSlipPdf = (req, res) =>
  pdfOrError(res, async () => {
    const payload = await svc.getStudentResults(req);
    const klass = payload.session?.classId
      ? await prisma.class.findFirst({ where: { id: payload.session.classId, schoolId: req.schoolId }, select: { name: true, stream: true } })
      : null;
    const lh = await loadLetterhead(req.schoolId);
    const name = `${payload.student?.firstName || ""}-${payload.student?.lastName || ""}`;
    const doc = startPdf(res, `result-slip-${safeFilePart(name)}-${safeFilePart(payload.session?.name)}.pdf`);
    const extras = await feeExtras(req.schoolId, lh, payload.student?.id);
    drawResultSlip(doc, lh, { payload, classLabel: klass ? `${klass.name}${klass.stream ? ` ${klass.stream}` : ""}` : "—", extras });
    doc.end();
  });

export const getStudentReportCardPdf = (req, res) =>
  pdfOrError(res, async () => {
    const report = await reportCards.getStudentReportCard(req);
    const lh = await loadLetterhead(req.schoolId);
    const st = report.students[0].student;
    const doc = startPdf(res, `report-card-${safeFilePart(`${st.firstName}-${st.lastName}`)}-${report.term}-${report.year}.pdf`);
    drawReportCard(doc, lh, report, await feeExtras(req.schoolId, lh, st.id));
    doc.end();
  });

export const getClassReportCardsPdf = (req, res) =>
  pdfOrError(res, async () => {
    const report = await reportCards.getClassReportCards(req);
    if (!report.students.length) throw Object.assign(new Error("No published exams for this class and term yet."), { statusCode: 404 });
    const lh = await loadLetterhead(req.schoolId);
    const cls = report.class ? `${report.class.name}${report.class.stream ? `-${report.class.stream}` : ""}` : "class";
    const doc = startPdf(res, `report-cards-${safeFilePart(cls)}-${report.term}-${report.year}.pdf`);
    // One learner per page, in class position order.
    for (let i = 0; i < report.students.length; i++) {
      if (i > 0) doc.addPage();
      const row = report.students[i];
      drawReportCard(doc, lh, { ...report, students: [row] }, await feeExtras(req.schoolId, lh, row.student.id));
    }
    doc.end();
  });
