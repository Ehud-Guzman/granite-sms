// src/App.jsx
import { Navigate, Route, Routes } from "react-router-dom";

import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AppShell from "./layouts/AppShell.jsx";
import AuthGuard from "./guards/AuthGuard.jsx";
import RoleGuard from "./guards/RoleGuard.jsx";

import Placeholder from "./pages/Placeholder.jsx";

// Students
import StudentsListPage from "./features/students/StudentsListPage.jsx";
import StudentProfilePage from "./features/students/StudentProfilePage.jsx";

// Classes
import ClassesListPage from "./features/classes/ClassesListPage.jsx";
import ClassDetailsPage from "./features/classes/ClassDetailsPage.jsx";

// Teachers
import TeachersListPage from "@/features/teachers/TeachersListPage.jsx";

// Attendance
import AttendancePage from "@/features/attendance/AttendancePage.jsx";
import AttendanceSessionPage from "@/features/attendance/AttendanceSessionPage.jsx";

// Fees
import FeesPage from "@/features/fees/FeesPage.jsx";

// Exams / Results
import MarksEntryPage from "@/features/exams/marks/MarksEntryPage.jsx";
import ExamsListPage from "@/features/exams/ExamsListPage.jsx";
import SessionMarkSheetsPage from "@/features/exams/SessionMarkSheetsPage.jsx";
import ResultsPage from "@/features/results/ResultsPage.jsx";

// Reports (layout + pages)
import ReportsPage from "@/features/reports/ReportsPage.jsx";
import ClassPerformanceReport from "@/features/reports/academic/ClassPerformanceReport.jsx";
import FeesSummaryReport from "@/features/reports/fees/FeesSummaryReport.jsx";
import FeesDefaultersReport from "@/features/reports/fees/FeesDefaultersReport.jsx";
import FeesCollectionsReport from "@/features/reports/fees/FeesCollectionsReport.jsx";

// ✅ Select School (SYSTEM_ADMIN)
import SelectSchoolPage from "./pages/SelectSchoolPage.jsx";

// Settings
import SettingsPage from "@/pages/SettingsPage.jsx";

// Auth extras
import ChangePasswordPage from "./pages/ChangePasswordPage.jsx";

/**
 * Roles (single source of truth for guards)
 */
const ROLE = {
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  ADMIN: "ADMIN",
  TEACHER: "TEACHER",
  BURSAR: "BURSAR",
  STUDENT: "STUDENT",
};

const R = ROLE;

// Guard groups
const ALL_ROLES = [R.SYSTEM_ADMIN, R.ADMIN, R.TEACHER, R.BURSAR, R.STUDENT];
const STAFF = [R.ADMIN, R.TEACHER, R.BURSAR];
const ADMIN_ONLY = [R.ADMIN];
const ADMIN_OR_SYSTEM = [R.ADMIN, R.SYSTEM_ADMIN];
const ADMIN_OR_TEACHER = [R.ADMIN, R.TEACHER];
const ADMIN_TEACHER_STUDENT = [R.ADMIN, R.TEACHER, R.STUDENT];
const FEES_ACCESS = [R.ADMIN, R.BURSAR, R.STUDENT];
const REPORTS_ACCESS = [R.ADMIN, R.BURSAR];
const FINANCE_REPORTS_ACCESS = [R.ADMIN, R.BURSAR];

export default function App() {
  return (
    <Routes>
      {/* --------------------
          Public
      -------------------- */}
      <Route path="/auth/login" element={<Login />} />

      {/* --------------------
          Protected (but NOT inside /app)
          SYSTEM_ADMIN selects school context here
      -------------------- */}
      <Route
        path="/select-school"
        element={
          <AuthGuard>
            <RoleGuard allow={[R.SYSTEM_ADMIN]}>
              <SelectSchoolPage />
            </RoleGuard>
          </AuthGuard>
        }
      />

      <Route
        path="/auth/change-password"
        element={
          <AuthGuard>
            <ChangePasswordPage />
          </AuthGuard>
        }
      />

      {/* --------------------
          Protected Shell (/app)
      -------------------- */}
      <Route
        path="/app"
        element={
          <AuthGuard>
            <AppShell />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />

        {/* Dashboard: all authenticated roles */}
        <Route path="dashboard" element={<Dashboard />} />

        {/* Students: ADMIN + TEACHER */}
        <Route
          path="students"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <StudentsListPage />
            </RoleGuard>
          }
        />
        <Route
          path="students/:id"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <StudentProfilePage />
            </RoleGuard>
          }
        />

        {/* Classes: ADMIN + TEACHER */}
        <Route
          path="classes"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <ClassesListPage />
            </RoleGuard>
          }
        />
        <Route
          path="classes/:id"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <ClassDetailsPage />
            </RoleGuard>
          }
        />

        {/* Teachers: ADMIN only */}
        <Route
          path="teachers"
          element={
            <RoleGuard allow={ADMIN_ONLY}>
              <TeachersListPage />
            </RoleGuard>
          }
        />

        {/* Attendance: ADMIN + TEACHER */}
        <Route
          path="attendance"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <AttendancePage />
            </RoleGuard>
          }
        />
        <Route
          path="attendance/:sessionId"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <AttendanceSessionPage />
            </RoleGuard>
          }
        />

        {/* Fees: ADMIN + BURSAR + STUDENT */}
        <Route
          path="fees"
          element={
            <RoleGuard allow={FEES_ACCESS}>
              <FeesPage />
            </RoleGuard>
          }
        />

        {/* Exams: ADMIN + TEACHER */}
        <Route
          path="exams"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <ExamsListPage />
            </RoleGuard>
          }
        />
        <Route
          path="exams/sessions/:sessionId/marksheets"
          element={
            <RoleGuard allow={ADMIN_OR_TEACHER}>
              <SessionMarkSheetsPage />
            </RoleGuard>
          }
        />
      <Route
  path="exams/marksheets/:marksheetId/marks-entry"
  element={
    <RoleGuard allow={ADMIN_OR_TEACHER}>
      <MarksEntryPage />
    </RoleGuard>
  }
/>


        {/* Results: ADMIN + TEACHER + STUDENT */}
        <Route
          path="results"
          element={
            <RoleGuard allow={ADMIN_TEACHER_STUDENT}>
              <ResultsPage />
            </RoleGuard>
          }
        />

        {/* --------------------
            REPORTS (nested)
            - Reports shell: ADMIN + BURSAR
            - Academic report: ADMIN only
            - Finance reports: ADMIN + BURSAR
        -------------------- */}
        <Route
          path="reports"
          element={
            <RoleGuard allow={REPORTS_ACCESS}>
              <ReportsPage />
            </RoleGuard>
          }
        >
          {/* Default landing: bursar-safe */}
          <Route index element={<Navigate to="fees/summary" replace />} />

          {/* Academic: ADMIN only */}
          <Route
            path="academic"
            element={
              <RoleGuard allow={ADMIN_ONLY}>
                <ClassPerformanceReport />
              </RoleGuard>
            }
          />

          {/* Finance (Fees): ADMIN + BURSAR */}
          <Route
            path="fees/summary"
            element={
              <RoleGuard allow={FINANCE_REPORTS_ACCESS}>
                <FeesSummaryReport />
              </RoleGuard>
            }
          />
          <Route
            path="fees/defaulters"
            element={
              <RoleGuard allow={FINANCE_REPORTS_ACCESS}>
                <FeesDefaultersReport />
              </RoleGuard>
            }
          />
          <Route
            path="fees/collections"
            element={
              <RoleGuard allow={FINANCE_REPORTS_ACCESS}>
                <FeesCollectionsReport />
              </RoleGuard>
            }
          />

          {/* Safety fallback */}
          <Route path="*" element={<Navigate to="fees/summary" replace />} />
        </Route>

        {/* Settings: ADMIN + SYSTEM_ADMIN */}
        <Route
          path="settings"
          element={
            <RoleGuard allow={ADMIN_OR_SYSTEM}>
              <SettingsPage />
            </RoleGuard>
          }
        />

        {/* If you later add more modules, protect them explicitly. */}
        <Route path="placeholder" element={<Placeholder />} />
      </Route>

      {/* --------------------
          Defaults
      -------------------- */}
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
