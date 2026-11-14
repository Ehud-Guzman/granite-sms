// src/modules/mpesa/promptGuard.js
// M-Pesa PIN prompts (STK push) appear on someone's phone and use the
// school's Daraja quota. Two rules (audit 2, A2-SEC-07):
//   1. The number must belong to one of the learner's guardians on file.
//   2. At most PROMPT_LIMIT prompts per number every PROMPT_WINDOW_MIN minutes.
import { prisma } from "../../lib/prisma.js";
import { normalizeKenyanPhone } from "../../utils/phone.js";

export const PROMPT_LIMIT = 3;
export const PROMPT_WINDOW_MIN = 10;

/** The learner's guardian numbers, in the form Daraja expects (2547...). */
export async function guardianPhones(schoolId, studentId) {
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, studentId },
    select: { guardian: { select: { phone: true } } },
  });
  return [...new Set(links.map((l) => normalizeKenyanPhone(l.guardian.phone)).filter(Boolean))];
}

/**
 * Returns null when a prompt to `phone` for this learner is allowed,
 * otherwise { status, message } to send back.
 */
export async function promptProblem({ schoolId, studentId, phone }) {
  const allowed = await guardianPhones(schoolId, studentId);
  if (!allowed.includes(phone)) {
    return { status: 400, message: "Payment prompts can only go to a parent or guardian number on this learner's record." };
  }
  const since = new Date(Date.now() - PROMPT_WINDOW_MIN * 60 * 1000);
  const recent = await prisma.mpesaStkRequest.count({ where: { schoolId, phone, createdAt: { gte: since } } });
  if (recent >= PROMPT_LIMIT) {
    return { status: 429, message: `This number already got ${PROMPT_LIMIT} payment prompts in the last ${PROMPT_WINDOW_MIN} minutes. Try again later.` };
  }
  return null;
}
