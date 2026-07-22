// src/App.jsx
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";

import AppShell from "./layouts/AppShell.jsx";
import AuthGuard from "./guards/AuthGuard.jsx";
import RoleGuard from "./guards/RoleGuard.jsx";

import SubscriptionBlockerProvider from "@/components/subscription/SubscriptionBlockerProvider";

const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Placeholder = lazy(() => import("./pages/Placeholder.jsx"));

// Students
const StudentsListPage = lazy(() => import("./features/students/StudentsListPage.jsx"));
const StudentProfilePage = lazy(() => import("./features/students/StudentProfilePage.jsx"));

// Classes
const ClassesListPage = lazy(() => import("./features/classes/ClassesListPage.jsx"));
const ClassDetailsPage = lazy(() => import("./features/classes/ClassDetailsPage.jsx"));

// Teachers
const TeachersListPage = lazy(() => import("@/features/teachers/TeachersListPage.jsx"));

// Attendance
const AttendancePage = lazy(() => import("@/features/attendance/AttendancePage.jsx"));
const AttendanceSessionPage = lazy(() => import("@/features/attendance/AttendanceSessionPage.jsx"));

// Fees
const FeesPage = lazy(() => import("@/features/fees/FeesPage.jsx"));

// Exams / Results
const MarksEntryPage = lazy(() => import("@/features/exams/marks/MarksEntryPage.jsx"));
const ExamsListPage = lazy(() => import("@/features/exams/ExamsListPage.jsx"));
const SessionMarkSheetsPage = lazy(() => import("@/features/exams/SessionMarkSheetsPage.jsx"));
const ResultsPage = lazy(() => import("@/features/results/ResultsPage.jsx"));

// Reports
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage.jsx"));
const ClassPerformanceReport = lazy(() => import("@/features/reports/academic/ClassPerformanceReport.jsx"));
const FeesSummaryReport = lazy(() => import("@/features/reports/fees/FeesSummaryReport.jsx"));
const FeesDefaultersReport = lazy(() => import("@/features/reports/fees/FeesDefaultersReport.jsx"));
const FeesCollectionsReport = lazy(() => import("@/features/reports/fees/FeesCollectionsReport.jsx"));
const AttendanceSummaryReport = lazy(() => import("@/features/reports/attendance/AttendanceSummaryReport.jsx"));
const AttendanceDefaultersReport = lazy(() => import("@/features/reports/attendance/AttendanceDefaultersReport.jsx"));

// Select School
const SelectSchoolPage = lazy(() => import("./pages/SelectSchoolPage.jsx"));

// Settings
const SettingsPage = lazy(() => import("@/pages/SettingsPage.jsx"));

// Auth extras
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage.jsx"));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

/**
 * Roles
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
const ADMIN_ONLY = [R.ADMIN];
const ADMIN_OR_SYSTEM = [R.ADMIN, R.SYSTEM_ADMIN];
const ADMIN_OR_TEACHER = [R.ADMIN, R.TEACHER];
const ADMIN_TEACHER_STUDENT = [R.ADMIN, R.TEACHER, R.STUDENT];
const FEES_ACCESS = [R.ADMIN, R.BURSAR, R.STUDENT];
const REPORTS_ACCESS = [R.ADMIN, R.BURSAR, R.TEACHER];
const FINANCE_REPORTS_ACCESS = [R.ADMIN, R.BURSAR];
const ATTENDANCE_REPORTS_ACCESS = [R.ADMIN, R.TEACHER];

export default function App() {
  return (
    <SubscriptionBlockerProvider>
      <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        {/* --------------------
            Public
        -------------------- */}
        <Route path="/auth/login" element={<Login />} />

        {/* --------------------
            Protected (NOT inside /app)
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

          <Route path="dashboard" element={<Dashboard />} />

          {/* Students */}
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

          {/* Classes */}
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

          {/* Teachers */}
          <Route
            path="teachers"
            element={
              <RoleGuard allow={ADMIN_ONLY}>
                <TeachersListPage />
              </RoleGuard>
            }
          />

          {/* Attendance */}
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

          {/* Fees */}
          <Route
            path="fees"
            element={
              <RoleGuard allow={FEES_ACCESS}>
                <FeesPage />
              </RoleGuard>
            }
          />

          {/* Exams */}
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

          {/* Results */}
          <Route
            path="results"
            element={
              <RoleGuard allow={ADMIN_TEACHER_STUDENT}>
                <ResultsPage />
              </RoleGuard>
            }
          />

          {/* Reports */}
          <Route
            path="reports"
            element={
              <RoleGuard allow={REPORTS_ACCESS}>
                <ReportsPage />
              </RoleGuard>
            }
          >
            <Route index element={<Navigate to="fees/summary" replace />} />

            <Route
              path="academic"
              element={
                <RoleGuard allow={ADMIN_ONLY}>
                  <ClassPerformanceReport />
                </RoleGuard>
              }
            />

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

            <Route
              path="attendance/summary"
              element={
                <RoleGuard allow={ATTENDANCE_REPORTS_ACCESS}>
                  <AttendanceSummaryReport />
                </RoleGuard>
              }
            />
            <Route
              path="attendance/defaulters"
              element={
                <RoleGuard allow={ATTENDANCE_REPORTS_ACCESS}>
                  <AttendanceDefaultersReport />
                </RoleGuard>
              }
            />

            <Route path="*" element={<Navigate to="fees/summary" replace />} />
          </Route>

          {/* Settings */}
          <Route
            path="settings"
            element={
              <RoleGuard allow={ADMIN_OR_SYSTEM}>
                <SettingsPage />
              </RoleGuard>
            }
          />

          <Route path="placeholder" element={<Placeholder />} />
        </Route>

        {/* Defaults */}
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      </Suspense>
    </SubscriptionBlockerProvider>
  );
}
