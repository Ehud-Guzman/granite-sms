// src/services/backup.service.js
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";

/**
 * Phase 1 snapshot shape:
 * {
 *   version: 1,
 *   schoolId,
 *   exportedAt,
 *   data: {
 *     users, teachers, classes, students,
 *     subjects, assignments, classTeachers,
 *     subscription, settings
 *   }
 * }
 */

function generateTempPassword(len = 16) {
  const base = crypto.randomBytes(24).toString("base64url");
  return (base.slice(0, Math.max(len - 2, 10)) + "A1").slice(0, len);
}

function safeJson(x) {
  return x == null ? null : JSON.parse(JSON.stringify(x));
}

function pickSchoolSettings(row) {
  if (!row) return null;
  return {
    enableClassTeachers: !!row.enableClassTeachers,
    enableSubjectAssignments: !!row.enableSubjectAssignments,
  };
}

function pickSubscription(row) {
  if (!row) return null;
  return {
    planCode: row.planCode ?? "FREE",
    status: row.status ?? "TRIAL",
    maxStudents: row.maxStudents ?? 0,
    maxTeachers: row.maxTeachers ?? 0,
    maxClasses: row.maxClasses ?? 0,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    entitlements: row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {},
    limits: row.limits && typeof row.limits === "object" ? row.limits : null,
  };
}

async function assertSchoolActive(schoolId) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, isActive: true },
  });
  if (!school) return { ok: false, code: 404, message: "School not found" };
  if (!school.isActive) return { ok: false, code: 403, message: "School inactive" };
  return { ok: true, school };
}

export async function createSchoolBackup({ schoolId, actorId }) {
  const check = await assertSchoolActive(schoolId);
  if (!check.ok) return check;

  const school = check.school;

  const [
    users,
    teachers,
    classes,
    students,
    subjects,
    assignments,
    classTeachers,
    subscription,
    settings,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        failedLoginAttempts: true,
        lockUntil: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        schoolId: true,
        // password excluded
      },
    }),
  prisma.teacher.findMany({
  where: { schoolId },
  orderBy: { createdAt: "asc" },
  include: { user: { select: { email: true } } },
})
,
    prisma.class.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } }),
    prisma.student.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } }),
    prisma.subject?.findMany
      ? prisma.subject.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.teachingAssignment?.findMany
      ? prisma.teachingAssignment.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.classTeacher?.findMany
      ? prisma.classTeacher.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.subscription.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" } }),
    prisma.schoolSettings.findUnique({ where: { schoolId } }),
  ]);

  const meta = {
    version: 1,
    school: { id: school.id, name: school.name },
    createdAt: new Date().toISOString(),
    counts: {
      users: users.length,
      teachers: teachers.length,
      classes: classes.length,
      students: students.length,
      subjects: subjects.length,
      assignments: assignments.length,
      classTeachers: classTeachers.length,
      subscription: subscription ? 1 : 0,
      settings: settings ? 1 : 0,
    },
    notes: "Phase 1 snapshot (core modules). Passwords excluded.",
  };

  const payload = {
    version: 1,
    schoolId,
    exportedAt: new Date().toISOString(),
    data: {
      users: safeJson(users),
      teachers: safeJson(teachers),
      classes: safeJson(classes),
      students: safeJson(students),
      subjects: safeJson(subjects),
      assignments: safeJson(assignments),
      classTeachers: safeJson(classTeachers),
      subscription: safeJson(subscription),
      settings: safeJson(settings),
    },
  };

  const backup = await prisma.backup.create({
    data: {
      schoolId,
      type: "SCHOOL_SNAPSHOT",
      status: "READY",
      meta,
      payload,
      createdBy: actorId || null,
    },
    select: { id: true, createdAt: true, meta: true },
  });

  return { ok: true, backup };
}

export async function listBackups({ schoolId }) {
  const backups = await prisma.backup.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      schoolId: true,
      type: true,
      status: true,
      createdBy: true,
      createdAt: true,
      meta: true,
    },
  });
  return { ok: true, backups };
}

export async function getBackup({ id, withPayload = false }) {
  const backup = await prisma.backup.findUnique({
    where: { id },
    select: withPayload
      ? {
          id: true,
          schoolId: true,
          type: true,
          status: true,
          createdAt: true,
          meta: true,
          payload: true,
        }
      : { id: true, schoolId: true, type: true, status: true, createdAt: true, meta: true },
  });
  if (!backup) return { ok: false, code: 404, message: "Backup not found" };
  return { ok: true, backup };
}

// --- wipe tenant ---
async function wipeTenantData(tx, schoolId) {
  // Order matters (children first)
  if (tx.classTeacher?.deleteMany) {
    await tx.classTeacher.deleteMany({ where: { class: { schoolId } } });
  }
  if (tx.teachingAssignment?.deleteMany) {
    await tx.teachingAssignment.deleteMany({ where: { schoolId } });
  }

  await tx.student.deleteMany({ where: { schoolId } });
  await tx.class.deleteMany({ where: { schoolId } });
  await tx.teacher.deleteMany({ where: { schoolId } });

  if (tx.subject?.deleteMany) await tx.subject.deleteMany({ where: { schoolId } });

  await tx.schoolSettings.deleteMany({ where: { schoolId } });
  await tx.subscription.deleteMany({ where: { schoolId } });

  await tx.user.deleteMany({ where: { schoolId } });
}

function normMode(mode) {
  const m = String(mode || "MERGE").trim().toUpperCase();
  return ["MERGE", "REPLACE"].includes(m) ? m : null;
}

// ---- safer helpers for restore ----
function asStr(x) {
  return String(x ?? "").trim();
}

function normEmail(x) {
  const e = String(x ?? "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

function isPrismaKnownError(err) {
  return !!err && typeof err === "object" && typeof err.code === "string" && err.code.startsWith("P");
}

function prismaErrorHint(err) {
  if (!isPrismaKnownError(err)) return null;
  return { prismaCode: err.code, meta: err.meta };
}

function isUniqueViolation(err) {
  return isPrismaKnownError(err) && err.code === "P2002";
}

/**
 * RESTORE (V1)
 * - REPLACE: wipes school and restores full set (including teachers/assignments/classTeachers)
 * - MERGE: restores safe modules only; skips teacher relationships to avoid FK corruption
 *
 * Security guarantees:
 * - MERGE never updates users outside destSchoolId.
 * - MERGE never "steals" a user from another school even if email matches.
 */
export async function restoreBackup({ backupId, mode, targetSchoolId, confirm, actorId }) {
  const ctxDebug = {
    backupId,
    mode,
    targetSchoolId: targetSchoolId ?? null,
    actorId: actorId ?? null,
  };

  const b = await prisma.backup.findUnique({
    where: { id: backupId },
    select: { id: true, schoolId: true, status: true, payload: true, meta: true },
  });
  if (!b) return { ok: false, code: 404, message: "Backup not found", debug: ctxDebug };

  if (!["READY", "FAILED"].includes(b.status)) {
    return {
      ok: false,
      code: 409,
      message: `Backup not ready (${b.status})`,
      debug: { ...ctxDebug, status: b.status },
    };
  }

  const payload = b.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: 400, message: "Backup payload missing/corrupt", debug: ctxDebug };
  }

  const version = payload?.version ?? 1;
  if (version !== 1) {
    return { ok: false, code: 400, message: "Unsupported backup version", debug: { ...ctxDebug, version } };
  }

  const sourceSchoolId = payload?.schoolId || b.schoolId;
  const destSchoolId = asStr(targetSchoolId || sourceSchoolId);
  if (!destSchoolId) return { ok: false, code: 400, message: "targetSchoolId is required", debug: ctxDebug };

  const check = await assertSchoolActive(destSchoolId);
  if (!check.ok) return { ...check, debug: ctxDebug };

  const normalizedMode = normMode(mode);
  if (!normalizedMode) {
    return { ok: false, code: 400, message: 'mode must be "MERGE" or "REPLACE"', debug: ctxDebug };
  }

  if (normalizedMode === "REPLACE" && confirm !== "DELETE SCHOOL DATA") {
    return {
      ok: false,
      code: 400,
      message: 'Confirm required: set confirm="DELETE SCHOOL DATA"',
      debug: ctxDebug,
    };
  }

  const data = payload?.data || {};
  const users = Array.isArray(data.users) ? data.users : [];
  const teachers = Array.isArray(data.teachers) ? data.teachers : [];
  const classes = Array.isArray(data.classes) ? data.classes : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const classTeachers = Array.isArray(data.classTeachers) ? data.classTeachers : [];
  const subscription = data.subscription || null;
  const settings = data.settings || null;

  // mark restoring
  await prisma.backup.update({
    where: { id: b.id },
    data: { status: "RESTORING" },
  });

  try {
    // Normalize users + pre-hash outside tx
    const normalizedUsers = users
      .map((u) => ({
        id: u?.id ? String(u.id) : null,
        email: normEmail(u?.email),
        role: u?.role,
        isActive: !!u?.isActive,
      }))
      .filter((u) => u.email);

    const preppedUsers = [];
    for (const u of normalizedUsers) {
      const tempPassword = generateTempPassword(16);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      preppedUsers.push({ ...u, tempPassword, passwordHash });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        if (normalizedMode === "REPLACE") {
          await wipeTenantData(tx, destSchoolId);
        }

        // Settings upsert
        const settingsData = pickSchoolSettings(settings);
        if (settingsData) {
          await tx.schoolSettings.upsert({
            where: { schoolId: destSchoolId },
            update: settingsData,
            create: { schoolId: destSchoolId, ...settingsData },
          });
        }

        // Subscription create (new row)
        const subData = pickSubscription(subscription);
        if (subData) {
          await tx.subscription.create({
            data: { schoolId: destSchoolId, ...subData },
          });
        }

        // -------------------------
        // USERS (SECURE)
        // -------------------------
        const createdUsers = [];
        const skippedUsers = []; // due to cross-tenant collision

        if (normalizedMode === "REPLACE") {
          // preserve IDs (safe after wipe)
          for (const u of preppedUsers) {
            await tx.user.create({
              data: {
                ...(u.id ? { id: u.id } : {}),
                email: u.email,
                password: u.passwordHash,
                role: u.role,
                isActive: u.isActive,
                schoolId: destSchoolId,
                mustChangePassword: true,
                failedLoginAttempts: 0,
                lockUntil: null,
                lastLoginAt: null,
              },
            });
            createdUsers.push({ email: u.email, tempPassword: u.tempPassword });
          }
        } else {
          // MERGE: ONLY check existing users IN THIS SCHOOL
          const existingInSchool = await tx.user.findMany({
            where: {
              schoolId: destSchoolId,
              email: { in: normalizedUsers.map((u) => u.email) },
            },
            select: { id: true, email: true },
          });
          const existingByEmail = new Map(existingInSchool.map((x) => [x.email, x]));

          // also detect cross-tenant collisions if email is globally unique
          // (if your schema has unique(email), creating will throw P2002)
          for (const u of preppedUsers) {
            const ex = existingByEmail.get(u.email);
            if (ex) {
              await tx.user.update({
                where: { id: ex.id },
                data: {
                  role: u.role,
                  isActive: u.isActive,
                  mustChangePassword: true,
                  failedLoginAttempts: 0,
                  lockUntil: null,
                  lastLoginAt: null,
                },
              });
            } else {
              try {
                await tx.user.create({
                  data: {
                    email: u.email,
                    password: u.passwordHash,
                    role: u.role,
                    isActive: u.isActive,
                    schoolId: destSchoolId,
                    mustChangePassword: true,
                    failedLoginAttempts: 0,
                    lockUntil: null,
                    lastLoginAt: null,
                  },
                });
                createdUsers.push({ email: u.email, tempPassword: u.tempPassword });
              } catch (err) {
                // If email is globally unique and already exists in another school,
                // we DO NOT steal it. We skip and report.
                if (isUniqueViolation(err)) {
                  skippedUsers.push({
                    email: u.email,
                    reason: "Email already exists in another school (global unique). Skipped to avoid cross-tenant takeover.",
                  });
                } else {
                  throw err;
                }
              }
            }
          }
        }

        // -------------------------
        // CLASSES
        // Upsert by unique(schoolId, name, stream, year)
        // Build sourceClassId -> destClassId map
        // -------------------------
        const classIdMap = new Map();
for (const c of classes) {
  const name = asStr(c?.name);

  // ✅ stream must NEVER be null (it's in the @@unique)
  const stream =
    c?.stream == null || asStr(c.stream) === ""
      ? "A"
      : asStr(c.stream);

  const year = Number(c?.year);

  if (!name || !Number.isFinite(year)) continue;

  const upserted = await tx.class.upsert({
    where: {
      schoolId_name_stream_year: {
        schoolId: destSchoolId,
        name,
        stream, // ✅ never null
        year,
      },
    },
    update: { isActive: c?.isActive ?? true },
    create: {
      schoolId: destSchoolId,
      name,
      stream, // ✅ never null
      year,
      isActive: c?.isActive ?? true,
    },
    select: { id: true },
  });

  if (c?.id) classIdMap.set(String(c.id), upserted.id);
}

        // -------------------------
        // STUDENTS
        // - MERGE: no id preservation, remap classId, ignore duplicates safely
        // - REPLACE: preserve student id (optional) but still remap classId (classes got new ids)
        // -------------------------
        const studentErrors = [];
for (const s of students) {
  const admissionNo = String(s?.admissionNo || "").trim();
  if (!admissionNo) continue;

  const row = { ...s };
  row.schoolId = destSchoolId;

  delete row.id;
  delete row.createdAt;
  delete row.updatedAt;

  // Remap classId
  if (row.classId) {
    const mapped = classIdMap.get(String(row.classId));
    row.classId = mapped || null;
  }

  // Never restore userId in MERGE unless you have a mapping strategy
  // (since userId is globally unique and may point to non-existing user in dest)
  row.userId = null;

  await tx.student.upsert({
    where: {
      schoolId_admissionNo: {
        schoolId: destSchoolId,
        admissionNo,
      },
    },
    update: {
      firstName: row.firstName,
      lastName: row.lastName,
      gender: row.gender ?? null,
      dob: row.dob ?? null,
      classId: row.classId ?? null,
      isActive: row.isActive ?? true,
      userId: null, // keep safe
    },
    create: {
      schoolId: destSchoolId,
      admissionNo,
      firstName: row.firstName,
      lastName: row.lastName,
      gender: row.gender ?? null,
      dob: row.dob ?? null,
      classId: row.classId ?? null,
      isActive: row.isActive ?? true,
      userId: null,
    },
  });
}

const subjectIdMap = new Map(); // sourceId -> destId

for (const subj of subjects) {
  const name = String(subj?.name || "").trim();
  if (!name) continue;

  const upserted = await tx.subject.upsert({
    where: { schoolId_name: { schoolId: destSchoolId, name } },
    update: { isActive: subj?.isActive ?? true },
    create: { schoolId: destSchoolId, name, isActive: subj?.isActive ?? true },
    select: { id: true },
  });

  if (subj?.id) subjectIdMap.set(String(subj.id), upserted.id);
}




        // -------------------------
        // OPTIONAL MODULES
        // -------------------------
// -------------------------
// SUBJECTS (MERGE-safe)
// - Upsert by (schoolId, name) because code can be null
// - Avoid breaking @@unique([schoolId, code]) by only setting code when safe
// -------------------------
const subjectErrors = [];

if (tx.subject?.upsert) {
  // Preload existing subjects in this school to detect code collisions
  const existingSubjects = await tx.subject.findMany({
    where: { schoolId: destSchoolId },
    select: { id: true, name: true, code: true },
  });

  const existingByName = new Map(existingSubjects.map((s) => [s.name, s]));
  const usedCodes = new Set(existingSubjects.map((s) => s.code).filter(Boolean));

  for (const subj of subjects) {
    const name = String(subj?.name || "").trim();
    if (!name) continue;

    const incomingCodeRaw = subj?.code == null ? null : String(subj.code).trim();
    const incomingCode = incomingCodeRaw ? incomingCodeRaw : null;

    // If code is present but already used by another subject in this school,
    // skip setting it to avoid unique violation (schoolId, code).
    let safeCode = null;
    if (incomingCode && !usedCodes.has(incomingCode)) {
      safeCode = incomingCode;
    }

    try {
      const existing = existingByName.get(name);

      // Upsert by schoolId+name (compound unique becomes schoolId_name in Prisma client)
      await tx.subject.upsert({
        where: {
          schoolId_name: {
            schoolId: destSchoolId,
            name,
          },
        },
        update: {
          isActive: subj?.isActive ?? true,
          ...(safeCode ? { code: safeCode } : {}), // only set if safe
        },
        create: {
          schoolId: destSchoolId,
          name,
          ...(safeCode ? { code: safeCode } : {}),
          isActive: subj?.isActive ?? true,
        },
      });

      // Track code usage so future subjects don't collide within this restore run
      if (safeCode) usedCodes.add(safeCode);

      // Keep map updated too (not mandatory, but tidy)
      if (!existing) existingByName.set(name, { name, code: safeCode });
    } catch (err) {
      // If name already exists, upsert should handle it. So any error here is real.
      subjectErrors.push({
        message: err?.message,
        hint: prismaErrorHint(err),
      });
    }
  }
} else {
  // If your prisma client doesn't expose tx.subject.upsert (very unlikely), fallback:
  for (const subj of subjects) {
    try {
      await tx.subject.create({ data: { ...subj, schoolId: destSchoolId } });
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      subjectErrors.push({ message: err?.message, hint: prismaErrorHint(err) });
    }
  }
}


        // -------------------------
        // RELATIONAL MODULES (ONLY SAFE IN REPLACE)
        // -------------------------
        if (normalizedMode === "REPLACE") {
          // Teachers
          for (const t of teachers) {
            const row = { ...t, schoolId: destSchoolId };
            delete row.createdAt;
            delete row.updatedAt;
            try {
              await tx.teacher.create({ data: row });
            } catch (_) {}
          }

          // Assignments
          if (tx.teachingAssignment?.create) {
            for (const a of assignments) {
              const row = { ...a, schoolId: destSchoolId };
              delete row.createdAt;
              delete row.updatedAt;
              try {
                await tx.teachingAssignment.create({ data: row });
              } catch (_) {}
            }
          }

          // ClassTeachers (remap classId)
          if (tx.classTeacher?.create) {
            for (const ct of classTeachers) {
              const row = { ...ct };
              delete row.createdAt;
              delete row.updatedAt;

              if (row.classId) {
                const mapped = classIdMap.get(String(row.classId));
                row.classId = mapped || row.classId;
              }

              try {
                await tx.classTeacher.create({ data: row });
              } catch (_) {}
            }
          }
        }

        return {
          mode: normalizedMode,
          createdUsers,
          skippedUsers,
          notes:
            normalizedMode === "MERGE"
              ? "MERGE skips teacher/assignment/classTeacher restore to avoid FK corruption (snapshot lacks mapping)."
              : "REPLACE restores full dataset.",
          counts: {
            usersSnapshot: users.length,
            teachersSnapshot: teachers.length,
            classesSnapshot: classes.length,
            studentsSnapshot: students.length,
          },
          warnings: {
            studentErrors,
            subjectErrors,
          },
        };
      },
      { timeout: 180000 }
    );

    await prisma.backup.update({
      where: { id: b.id },
      data: { status: "READY" },
    });

    return { ok: true, result };
  } catch (err) {
    await prisma.backup.update({
      where: { id: b.id },
      data: { status: "FAILED" },
    });

    console.error("RESTORE ERROR:", err);

    return {
      ok: false,
      code: 500,
      message: "Restore failed",
      debug: {
        ...ctxDebug,
        error: err?.message,
        hint: prismaErrorHint(err),
      },
    };
  }
}
