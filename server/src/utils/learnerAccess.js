// src/utils/learnerAccess.js
// Which learners a student or parent may see. Staff access is handled by
// their own role checks; this covers the self-service roles:
//   STUDENT -> only themselves
//   PARENT  -> only learners they are linked to as a guardian (StudentGuardian)
import { prisma } from "../lib/prisma.js";

/** Learner ids visible to a STUDENT or PARENT caller (empty for anyone else). */
export async function ownLearnerIds(req) {
  if (req.role === "STUDENT" || req.user?.role === "STUDENT") return req.user?.studentId ? [req.user.studentId] : [];
  if (req.role === "PARENT" || req.user?.role === "PARENT") {
    if (!req.user?.guardianId) return [];
    const links = await prisma.studentGuardian.findMany({
      where: { schoolId: req.schoolId, guardianId: req.user.guardianId },
      select: { studentId: true },
    });
    return links.map((l) => l.studentId);
  }
  return [];
}

/** True if a STUDENT/PARENT caller may see this learner. */
export async function canSeeOwnLearner(req, studentId) {
  return (await ownLearnerIds(req)).includes(String(studentId));
}

export const isSelfService = (req) => ["STUDENT", "PARENT"].includes(req.role || req.user?.role);
