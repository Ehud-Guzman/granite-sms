// src/modules/attendance/attendance.permissions.js
import { prisma } from "../../lib/prisma.js";

const WRITE_FLAG = "ATTENDANCE_WRITE";

/**
 * Loads subscription entitlements for a school.
 * - You can adjust the status rules to match your fees module.
 */
export async function getSchoolEntitlements(schoolId) {
  const sub = await prisma.subscription.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });

  return {
    status: sub?.status || "TRIAL",
    entitlements: (sub?.entitlements || {}),
  };
}

export function requireSchool(req, res, next) {
  const schoolId = req.user?.schoolId;
  if (!schoolId) {
    return res.status(401).json({ message: "Missing schoolId in token" });
  }
  next();
}

export async function requireAttendanceWrite(req, res, next) {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) return res.status(401).json({ message: "Missing schoolId in token" });

    const { status, entitlements } = await getSchoolEntitlements(schoolId);

    // Basic policy:
    // - ACTIVE/TRIAL/PAST_DUE => allowed if entitlement flag enabled
    // - EXPIRED/CANCELED => no writes
    const blocked = ["EXPIRED", "CANCELED"].includes(status);
    if (blocked) {
      return res.status(402).json({ message: "Subscription inactive. Attendance is read-only." });
    }

    const canWrite = entitlements?.[WRITE_FLAG] === true;

    if (!canWrite) {
      return res.status(403).json({ message: "Attendance is locked (read-only subscription)." });
    }

    next();
  } catch (err) {
    return res.status(500).json({ message: "Entitlement check failed", error: err.message });
  }
}
