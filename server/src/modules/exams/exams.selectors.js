// src/modules/exams/exams.selectors.js
export const examTypeSelect = {
  id: true,
  name: true,
  code: true,
  weight: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const examSessionSelect = {
  id: true,
  year: true,
  term: true,
  classId: true,
  examTypeId: true,
  status: true,
  name: true,
  startsOn: true,
  endsOn: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  examType: { select: { id: true, name: true, code: true, weight: true } },
};

export const markSheetSelect = {
  id: true,
  examSessionId: true,
  subjectId: true,
  teacherId: true,
  status: true,
  submittedAt: true,
  submittedById: true,
  unlockedAt: true,
  unlockedById: true,
  unlockReason: true,
  createdAt: true,
  updatedAt: true,

  
  subject: { select: { id: true, name: true, code: true } },
};

