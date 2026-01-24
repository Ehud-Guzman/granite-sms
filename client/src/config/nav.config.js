export const NAV_BY_ROLE = {
  SYSTEM_ADMIN: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Settings", to: "/app/settings" },
  ],

  ADMIN: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Students", to: "/app/students" },
    { label: "Classes", to: "/app/classes" },
    { label: "Teachers", to: "/app/teachers" },
    { label: "Attendance", to: "/app/attendance" },
    { label: "Exams", to: "/app/exams" },
    { label: "Results", to: "/app/results" },
    { label: "Fees", to: "/app/fees" },
    { label: "Reports", to: "/app/reports" },
    { label: "Settings", to: "/app/settings" },
  ],

  TEACHER: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Attendance", to: "/app/attendance" },
    { label: "Exams", to: "/app/exams" },
    { label: "Results", to: "/app/results" },
    { label: "My Students", to: "/app/students" },
  ],

  STUDENT: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Results", to: "/app/results" },
    { label: "Fees", to: "/app/fees" },
  ],

  BURSAR: [
    { label: "Dashboard", to: "/app/dashboard" },
    { label: "Fees", to: "/app/fees" },
    { label: "Reports", to: "/app/reports" },
  ],
};
