// src/features/reports/ReportsPage.jsx
import { Link, Outlet, Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/hooks/useMe";
import { PageHeader } from "@/components/insights/Insights";
import { PageSkeleton } from "@/components/ui/state-blocks";

const norm = (v) => String(v || "").trim().toUpperCase();

export default function ReportsPage() {
  const location = useLocation();
  const { data, isLoading, isError } = useMe();

  if (isLoading) return <PageSkeleton />;
  if (isError || !data?.user) return <Navigate to="/auth/login" replace />;

  const role = norm(data.user.role);

  const canSeeAcademic = role === "ADMIN";
  const canSeeFees = role === "ADMIN" || role === "BURSAR";
  const canSeeAttendance = role === "ADMIN" || role === "TEACHER";

  // If user lands on /app/reports directly (or /app/reports/),
  // redirect to the best allowed section to avoid "blank outlet" feeling.
  const atRoot =
    location.pathname === "/app/reports" || location.pathname === "/app/reports/";

  if (atRoot) {
    if (canSeeFees) return <Navigate to="/app/reports/fees/summary" replace />;
    if (canSeeAcademic) return <Navigate to="/app/reports/academic" replace />;
    if (canSeeAttendance) return <Navigate to="/app/reports/attendance/summary" replace />;
    // Should never happen because App.jsx already guards /reports,
    // but keep as a safe fallback:
    return <Navigate to="/app/dashboard" replace />;
  }

  const sections = [
    canSeeFees && { to: "/app/reports/fees/summary", match: "/app/reports/fees", label: "Fees" },
    canSeeAcademic && { to: "/app/reports/academic", match: "/app/reports/academic", label: "Exams" },
    canSeeAttendance && { to: "/app/reports/attendance/summary", match: "/app/reports/attendance", label: "Attendance" },
  ].filter(Boolean);

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader className="no-print" eyebrow="Reports" title="How the school is doing" subtitle="Fees, exams and attendance. Print or export any report." />
      {sections.length > 1 && (
        <nav className="flex flex-wrap gap-2 no-print" aria-label="Report sections">
          {sections.map((t) => {
            const active = location.pathname.startsWith(t.match);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
      {!sections.length && <div className="text-sm text-muted-foreground">No report sections are available for your role.</div>}
      <Outlet />
    </div>
  );
}
