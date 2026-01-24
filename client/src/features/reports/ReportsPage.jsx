// src/features/reports/ReportsPage.jsx
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/hooks/useMe";

function Tab({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md border text-sm transition ${
          isActive ? "bg-black text-white" : "bg-white hover:bg-muted"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

const norm = (v) => String(v || "").trim().toUpperCase();

export default function ReportsPage() {
  const location = useLocation();
  const { data, isLoading, isError } = useMe();

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || !data?.user) return <Navigate to="/auth/login" replace />;

  const role = norm(data.user.role);

  const canSeeAcademic = role === "ADMIN";
  const canSeeFees = role === "ADMIN" || role === "BURSAR";

  // If user lands on /app/reports directly (or /app/reports/),
  // redirect to the best allowed section to avoid "blank outlet" feeling.
  const atRoot =
    location.pathname === "/app/reports" || location.pathname === "/app/reports/";

  if (atRoot) {
    if (canSeeFees) return <Navigate to="/app/reports/fees/summary" replace />;
    if (canSeeAcademic) return <Navigate to="/app/reports/academic" replace />;
    // Should never happen because App.jsx already guards /reports,
    // but keep as a safe fallback:
    return <Navigate to="/app/dashboard" replace />;
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="opacity-70 mt-1">Read-only analytics (Academic & Finance).</p>
      </div>

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Sections</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-wrap gap-2">
          {canSeeAcademic && (
            <Tab to="/app/reports/academic" end>
              Academic
            </Tab>
          )}

          {canSeeFees && <Tab to="/app/reports/fees/summary">Finance (Fees)</Tab>}

          {/* If somehow no tabs are available */}
          {!canSeeAcademic && !canSeeFees && (
            <div className="text-sm text-muted-foreground">
              No report sections are available for your role.
            </div>
          )}
        </CardContent>
      </Card>

      <Outlet />
    </div>
  );
}
