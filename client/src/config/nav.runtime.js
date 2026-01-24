import { NAV_BY_ROLE } from "./nav.config";
import { capsFor } from "./capabilities"; 

export function getNavForUser(me) {
  const role = me?.role;
  if (!role) return [];

  const caps = capsFor(role);
  const base = NAV_BY_ROLE[role] || [];

  return base.filter((item) => {
    // Gate by capability (adjust keys as you like)
    if (item.to === "/app/exams") return !!caps.canManageExams;
    if (item.to === "/app/results") return !!caps.canViewResults;
    if (item.to === "/app/attendance") return !!caps.canManageAttendance;
    if (item.to === "/app/reports") return !!caps.canViewReports;
    if (item.to === "/app/settings") return !!caps.canAccessSettings; // usually true for ADMIN/SYSTEM_ADMIN

    return true;
  });
}
