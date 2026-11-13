// The sidebar for each role. Items are grouped (the group is shown as a small
// heading) and carry an icon name; layouts/AppShell.jsx maps names to icons.
export const NAV_GROUP_ORDER = ["Overview", "People", "Teaching", "Learning", "Money", "Insights", "School"];

const home = (label = "Dashboard") => ({ label, to: "/app/dashboard", icon: "home", group: "Overview" });
const notices = { label: "Notices", to: "/app/notices", icon: "notices", group: "Overview" };

export const NAV_BY_ROLE = {
  SYSTEM_ADMIN: [home(), { label: "Settings", to: "/app/settings", icon: "settings", group: "School" }],

  ADMIN: [
    home(),
    notices,
    { label: "Students", to: "/app/students", icon: "students", group: "People" },
    { label: "Classes", to: "/app/classes", icon: "classes", group: "People" },
    { label: "Teachers", to: "/app/teachers", icon: "teachers", group: "People" },
    { label: "Attendance", to: "/app/attendance", icon: "attendance", group: "Teaching" },
    { label: "Exams", to: "/app/exams", icon: "exams", group: "Teaching" },
    { label: "Results", to: "/app/results", icon: "results", group: "Teaching" },
    { label: "Report cards", to: "/app/report-cards", icon: "reportCards", group: "Teaching" },
    { label: "Fees", to: "/app/fees", icon: "fees", group: "Money" },
    { label: "Reports", to: "/app/reports", icon: "reports", group: "Insights" },
    { label: "Settings", to: "/app/settings", icon: "settings", group: "School" },
  ],

  TEACHER: [
    home(),
    notices,
    { label: "Attendance", to: "/app/attendance", icon: "attendance", group: "Teaching" },
    { label: "Exams", to: "/app/exams", icon: "exams", group: "Teaching" },
    { label: "Results", to: "/app/results", icon: "results", group: "Teaching" },
    { label: "Report cards", to: "/app/report-cards", icon: "reportCards", group: "Teaching" },
    { label: "My students", to: "/app/students", icon: "students", group: "People" },
    { label: "Reports", to: "/app/reports", icon: "reports", group: "Insights" },
  ],

  BURSAR: [
    home(),
    notices,
    { label: "Fees", to: "/app/fees", icon: "fees", group: "Money" },
    { label: "Reports", to: "/app/reports", icon: "reports", group: "Insights" },
  ],

  STUDENT: [
    home("Home"),
    notices,
    { label: "Results", to: "/app/results", icon: "results", group: "Learning" },
    { label: "Report cards", to: "/app/report-cards", icon: "reportCards", group: "Learning" },
    { label: "Fees", to: "/app/fees", icon: "fees", group: "Money" },
  ],

  PARENT: [home("Home"), notices],
};
