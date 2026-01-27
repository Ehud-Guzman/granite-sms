import { useEffect, useMemo } from "react";
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { NAV_BY_ROLE } from "../config/nav.config";
import { capsFor } from "../config/capabilities";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { useMe } from "@/hooks/useMe";
import { logout as doLogout, getToken, getSelectedSchool } from "@/api/auth.api";
import { getBranding } from "@/api/settingsBranding.api";

import { applyAppearance } from "@/lib/appearance";

/* =========================
   Helpers
========================= */

function filterNavByCaps(role, navItems) {
  const caps = capsFor(role);

  return (navItems || []).filter((item) => {
    if (item.to === "/app/exams") return !!caps.canManageExams;
    if (item.to === "/app/results") return !!caps.canViewResults;
    if (item.to === "/app/attendance") return !!caps.canManageAttendance;
    if (item.to === "/app/reports") return !!caps.canViewReports;
    if (item.to === "/app/settings") return !!caps.canAccessSettings;
    return true;
  });
}

function getPageTitle(pathname) {
  if (pathname.includes("/app/dashboard")) return "Dashboard";
  if (pathname.includes("/app/students")) return "Students";
  if (pathname.includes("/app/classes")) return "Classes";
  if (pathname.includes("/app/teachers")) return "Teachers";
  if (pathname.includes("/app/attendance")) return "Attendance";
  if (pathname.includes("/app/exams")) return "Exams";
  if (pathname.includes("/app/results")) return "Results";
  if (pathname.includes("/app/fees")) return "Fees";
  if (pathname.includes("/app/reports")) return "Reports";
  if (pathname.includes("/app/settings")) return "Settings";
  return "SMS";
}

// ✅ One canonical query key everywhere in the app
function brandingKey(schoolId) {
  return ["settings", "branding", schoolId || "none"];
}

/* =========================
   Component
========================= */

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const token = getToken();
  const meQ = useMe();
  const data = meQ.data;

  const user = data?.user || null;
  const role = user?.role || "STUDENT";

  const selectedSchool = getSelectedSchool();
  const effectiveSchoolId = selectedSchool?.id ?? user?.schoolId ?? null;

  const schoolName =
    selectedSchool?.name ?? data?.school?.name ?? user?.school?.name ?? "-";

  const navItems = useMemo(() => {
    const base = NAV_BY_ROLE[role] || NAV_BY_ROLE.STUDENT;
    return filterNavByCaps(role, base);
  }, [role]);

  const title = useMemo(() => getPageTitle(location.pathname), [location.pathname]);

  const logout = () => {
    doLogout();
    navigate("/auth/login", { replace: true });
  };

  // ✅ Fetch branding per school (and cache per school)
  const brandingQ = useQuery({
    queryKey: brandingKey(effectiveSchoolId),
    queryFn: () => getBranding({ schoolId: effectiveSchoolId }),
    enabled: !!token && !!effectiveSchoolId,
    staleTime: 60_000,
  });

  // ✅ Apply appearance from persisted settings
  useEffect(() => {
    if (!brandingQ.data) return;
    // brandingQ.data should already be the flattened branding object (your api returns data.branding)
    applyAppearance(brandingQ.data);
  }, [brandingQ.data]);

  // -------------------------
  // Auth gates
  // -------------------------
  if (!token) return <Navigate to="/auth/login" replace />;
  if (meQ.isLoading) return <div className="p-6">Loading...</div>;
  if (meQ.isError) return <Navigate to="/auth/login" replace />;

  // Force password change
  if (user?.mustChangePassword && location.pathname !== "/auth/change-password") {
    return <Navigate to="/auth/change-password" replace />;
  }

  // SYSTEM_ADMIN must choose a school context before entering /app
  if (role === "SYSTEM_ADMIN" && !effectiveSchoolId) {
    if (location.pathname !== "/select-school") {
      return <Navigate to="/select-school" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-64 flex-col border-r bg-card">
          <div className="ui-pad">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-lg font-semibold">SMS</div>
              <Badge variant="outline" className="text-xs font-normal">
                {role}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground truncate">{schoolName}</div>
          </div>

          <Separator />

          <nav className="ui-pad flex-1 space-y-1">
            {navItems.map((item) => (
              <NavItem key={item.to} to={item.to} label={item.label} />
            ))}
          </nav>

          <div className="ui-pad border-t">
            <Button variant="ghost" className="w-full justify-start" onClick={logout}>
              Logout
            </Button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="h-12 ui-pad flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="lg:hidden">
                  <MobileNav
                    navItems={navItems}
                    role={role}
                    schoolName={schoolName}
                    logout={logout}
                  />
                </div>
                <div className="text-base font-semibold">{title}</div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">
                  {schoolName}
                </div>
                <Badge variant="outline" className="text-xs font-normal">
                  {role}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="hidden sm:inline-flex"
                >
                  Logout
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Nav Item
========================= */

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
          isActive
            ? "bg-primary text-primary-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        ].join(" ")
      }
    >
      <span>{label}</span>
    </NavLink>
  );
}

/* =========================
   Mobile Nav
========================= */

function MobileNav({ navItems, role, schoolName, logout }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="px-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 4H14M2 8H14M2 12H14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold">SMS</SheetTitle>
            <Badge variant="outline" className="text-xs font-normal">
              {role}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground truncate">{schoolName}</div>
        </SheetHeader>

        <nav className="p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <Button variant="ghost" className="w-full justify-start" onClick={logout}>
            Logout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
