export const NAV_BY_ROLE = {
  SYSTEM_ADMIN: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Settings", to: "/app/settings" },
  ],

  ADMIN: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Notices", to: "/app/notices" },
    { label: "Students", to: "/app/students" },
    { label: "Classes", to: "/app/classes" },
    { label: "Teachers", to: "/app/teachers" },
    { label: "Attendance", to: "/app/attendance" },
    { label: "Exams", to: "/app/exams" },
    { label: "Results", to: "/app/results" },
    { label: "Report cards", to: "/app/report-cards" },
    { label: "Fees", to: "/app/fees" },
    { label: "Reports", to: "/app/reports" },
    { label: "Settings", to: "/app/settings" },
  ],

  TEACHER: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Notices", to: "/app/notices" },
    { label: "Attendance", to: "/app/attendance" },
    { label: "Exams", to: "/app/exams" },
    { label: "Results", to: "/app/results" },
    { label: "Report cards", to: "/app/report-cards" },
    { label: "My Students", to: "/app/students" },
  ],

  PARENT: [
    { label: "Home", to: "/app/dashboard" },
    { label: "Notices", to: "/app/notices" },
  ],

  STUDENT: [
    { label: "Home", to: "/app/dashboard" },
    { label: "Notices", to: "/app/notices" },
    { label: "Results", to: "/app/results" },
    { label: "Report cards", to: "/app/report-cards" },
    { label: "Fees", to: "/app/fees" },
  ],

  BURSAR: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Notices", to: "/app/notices" },
    { label: "Fees", to: "/app/fees" },
    { label: "Reports", to: "/app/reports" },
  ],
};
