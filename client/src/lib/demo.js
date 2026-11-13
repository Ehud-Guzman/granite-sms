// src/lib/demo.js
//
// The portfolio demo build (server side: server/src/config/demo.js).
// Switched on at build time with VITE_DEMO_MODE=true, so the normal build
// carries none of this on screen.

export const IS_DEMO = String(import.meta.env.VITE_DEMO_MODE || "").trim().toLowerCase() === "true";

// Where "Back to portfolio" goes. Empty means the link is not shown.
export const PORTFOLIO_URL = String(import.meta.env.VITE_PORTFOLIO_URL || "").trim();

// One button per role on the demo's sign-in page. The server signs the visitor
// in as the matching sample account (POST /api/auth/demo-login).
export const DEMO_ROLES = [
  {
    role: "ADMIN",
    label: "School Admin",
    note: "Students, classes, teachers, attendance, exams, fees, reports and settings",
  },
  {
    role: "TEACHER",
    label: "Teacher",
    note: "Grace Wanjiru: her classes, attendance registers and marks entry",
  },
  {
    role: "BURSAR",
    label: "Bursar",
    note: "Invoices, payments, receipts and fee reports",
  },
  {
    role: "STUDENT",
    label: "Student",
    note: "Zawadi Kiptoo (Grade 7 East): her results and fee statement",
  },
  {
    role: "PARENT",
    label: "Parent",
    note: "Mary Kiptoo: her two children's fees, results and school notices",
  },
  {
    role: "SYSTEM_ADMIN",
    label: "Platform Owner",
    note: "Every school on the platform, plans, users and backups",
  },
];
