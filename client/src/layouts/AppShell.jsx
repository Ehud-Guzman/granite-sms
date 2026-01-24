import { useEffect, useMemo } from "react";
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { NAV_BY_ROLE } from "../config/nav.config";

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

import { capsFor } from "../config/capabilities";

import { useMe } from "@/hooks/useMe";
import { logout as doLogout, getToken, getSelectedSchool } from "@/api/auth.api";

import { getBranding } from "@/api/settingsBranding.api";
import { applyBrandingVars } from "@/lib/branding";


function filterNavByCaps(role, navItems) {
  const caps = capsFor(role);

  return (navItems || []).filter((item) => {
    // Gate whole modules based on capability flags
    if (item.to === "/app/exams") return !!caps.canManageExams;
    if (item.to === "/app/results") return !!caps.canViewResults;
    if (item.to === "/app/attendance") return !!caps.canManageAttendance;
    if (item.to === "/app/reports") return !!caps.canViewReports;
    if (item.to === "/app/settings") return !!caps.canAccessSettings;

    // Everything else passes
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

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ Always compute token first (no hooks blocked by this)
  const token = getToken();

  // ✅ Hooks must always run
  const meQ = useMe();
  const data = meQ.data;
  const isLoading = meQ.isLoading;
  const isError = meQ.isError;

  const user = data?.user || null;
  const role = user?.role || "STUDENT";

  const selectedSchool = getSelectedSchool();
  const effectiveSchoolId = selectedSchool?.id ?? user?.schoolId ?? null;

  const schoolName =
    selectedSchool?.name ??
    data?.school?.name ??
    user?.school?.name ??
    "-";

  const navItems = useMemo(() => { const base = NAV_BY_ROLE[role] || NAV_BY_ROLE.STUDENT;
     return filterNavByCaps(role, base);
  }, [role]);
  const title = useMemo(() => getPageTitle(location.pathname), [location.pathname]);

  const logout = () => {
    doLogout();
    navigate("/auth/login", { replace: true });
  };

  /* =========================
     Branding apply (Tenant only)
     - Applies saved brand vars on app entry / refresh
     - SYSTEM_ADMIN excluded
  ========================= */

  const brandingQ = useQuery({
    queryKey: ["settings", "branding", "tenant-apply", effectiveSchoolId || "none"],
    queryFn: () => getBranding(), // tenant scope (no params)
    enabled: !!token && !!effectiveSchoolId && role !== "SYSTEM_ADMIN",
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!brandingQ.data) return;

    applyBrandingVars({
      brandPrimaryColor: brandingQ.data.brandPrimaryColor || "#111827",
      brandSecondaryColor: brandingQ.data.brandSecondaryColor || "#2563eb",
    });
  }, [brandingQ.data]);

  /* =========================
     Redirect / gatekeeping (after hooks)
  ========================= */

  // Not logged in
  if (!token) return <Navigate to="/auth/login" replace />;

  // Waiting for /api/me
  if (isLoading) return <div className="p-6">Loading...</div>;

  // Bad token / server error
  if (isError) return <Navigate to="/auth/login" replace />;

  // Force password change
  if (user?.mustChangePassword && location.pathname !== "/auth/change-password") {
    return <Navigate to="/auth/change-password" replace />;
  }

  // SYSTEM_ADMIN must select school before /app (allow /select-school)
  if (role === "SYSTEM_ADMIN" && !effectiveSchoolId) {
    if (location.pathname !== "/select-school") {
      return <Navigate to="/select-school" replace />;
    }
  }

  /* =========================
     Render
  ========================= */

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-72 flex-col border-r bg-background">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold tracking-tight">SMS</div>
              <Badge variant="secondary" className="uppercase text-[10px]">
                {role}
              </Badge>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              School: <span className="font-medium">{schoolName}</span>
            </div>
          </div>

          <Separator />

          <nav className="p-3 flex-1 space-y-1">
            {navItems.map((item) => (
              <NavItem key={item.to} to={item.to} label={item.label} />
            ))}
          </nav>

          <Separator />

          <div className="p-4">
            <Button variant="outline" className="w-full" onClick={logout}>
              Logout
            </Button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
            <div className="h-14 px-4 md:px-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Mobile menu */}
                <div className="lg:hidden">
                  <MobileNav
                    navItems={navItems}
                    role={role}
                    schoolName={schoolName}
                    logout={logout}
                  />
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    School Management System
                  </div>
                  <div className="text-base font-semibold">{title}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="uppercase text-[10px]">
                  {role}
                </Badge>
                <Button
                  variant="outline"
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

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        ].join(" ")
      }
    >
      <span className="font-medium">{label}</span>
    </NavLink>
  );
}

function MobileNav({ navItems, role, schoolName, logout }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Menu
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-80">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>SMS</span>
            <Badge variant="secondary" className="uppercase text-[10px]">
              {role}
            </Badge>
          </SheetTitle>

          <div className="text-xs text-muted-foreground">
            School: <span className="font-medium">{schoolName}</span>
          </div>
        </SheetHeader>

        <div className="mt-5">
          <Separator />
        </div>

        <nav className="mt-4 space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        <div className="mt-6">
          <Separator />
        </div>

        <div className="mt-4">
          <Button variant="outline" className="w-full" onClick={logout}>
            Logout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
