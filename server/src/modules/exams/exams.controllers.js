// src/modules/exams/exams.controllers.js
import * as svc from "./exams.services.js";

export async function wrap(req, res, fn) {
  try {
    const data = await fn(req);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || "Request failed" });
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
export const getClassResults = (req, res) => wrap(req, res, svc.getClassResults);
export const getStudentResults = (req, res) => wrap(req, res, svc.getStudentResults);