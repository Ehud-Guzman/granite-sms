// client/src/config/capabilities.js
export const CAPS = {
  SYSTEM_ADMIN: {
    // Core
    canAccessSettings: true,

    // Platform control plane
    canManageSchools: true,
    canManageSubscriptions: true,
    canBackupRestore: true,
    canViewBackup: true,
    canViewAuditLogs: true,

    // Modules
    canManageExams: true,
    canManageAttendance: true,
    canViewReports: true,
    canViewResults: true,
  },

  ADMIN: {
    canAccessSettings: true,

    // Tenant-only (no platform ops)
    canManageSchools: false,
    canManageSubscriptions: false,
    canBackupRestore: false,
    canViewBackup: false,
    canViewAuditLogs: true, // ✅ recommended: admins should see audit logs for accountability

    // Modules
    canManageExams: true,
    canManageAttendance: true,
    canViewReports: true,
    canViewResults: true,
  },

  BURSAR: {
    canAccessSettings: false, // ✅ usually no settings access

    canManageSchools: false,
    canManageSubscriptions: false,
    canBackupRestore: false,
    canViewBackup: false,
    canViewAuditLogs: false,

    canManageExams: false,
    canManageAttendance: false,
    canViewReports: true, // bursar needs reports
    canViewResults: false,
  },

  TEACHER: {
    canAccessSettings: false, // ✅ usually no settings access

    canManageSchools: false,
    canManageSubscriptions: false,
    canBackupRestore: false,
    canViewBackup: false,
    canViewAuditLogs: false,

    canManageExams: true,       // read + marks entry (if allowed)
    canManageAttendance: true,  // attendance
    canViewReports: false,
    canViewResults: true,       // teachers typically view results
  },

  STUDENT: {
    canAccessSettings: false,

    canManageSchools: false,
    canManageSubscriptions: false,
    canBackupRestore: false,
    canViewBackup: false,
    canViewAuditLogs: false,

    canManageExams: false,
    canManageAttendance: false,
    canViewReports: false,
    canViewResults: true, // student sees own results
  },
};

export function capsFor(role) {
  return CAPS[String(role || "").toUpperCase()] || {};
}
