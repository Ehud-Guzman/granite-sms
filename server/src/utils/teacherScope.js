// src/utils/teacherScope.js
import { prisma } from "../lib/prisma.js";

/**
 * Classes a teacher may see: class teacher of, or teaches a subject in.
 * The one rule students, guardians, attendance and exams all use (audit M7).
 */
export async function teacherClassIds(schoolId, teacherId) {
  if (!teacherId) return [];
  const [ct, ta] = await Promise.all([
    prisma.classTeacher.findMany({ where: { schoolId, teacherId: String(teacherId), isActive: true }, select: { classId: true } }),
    prisma.teachingAssignment.findMany({ where: { schoolId, teacherId: String(teacherId), isActive: true }, select: { classId: true } }),
  ]);
  return [...new Set([...ct, ...ta].map((r) => r.classId))];
}
