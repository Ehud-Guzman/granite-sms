import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  PieChart,
  School,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { NAV_BY_ROLE, NAV_GROUP_ORDER } from "../config/nav.config";
import { capsFor } from "../config/capabilities";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/api/axios";

import { applyAppearance } from "@/lib/appearance";
import QuickSearch from "@/components/QuickSearch";
import { ALL_ON, filterByPlan, moduleOfPath } from "@/lib/planFeatures";

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

// Learners and parents call their landing page "Home" in the sidebar; match it.
function getPageTitle(pathname, role) {
  if (pathname.includes("/app/dashboard")) return role === "STUDENT" || role === "PARENT" ? "Home" : "Dashboard";
  if (pathname.includes("/app/notices")) return "Notices";
  if (pathname.includes("/app/report-cards") || pathname.includes("/report-card")) return "Report cards";
  if (pathname.includes("/statement")) return "Fee statement";
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
const MODULE_NAME = { exams: "Exams and results", fees: "Fees", attendance: "Attendance" };

/** A lapsed plan: everything still opens, but nothing can be changed. */
function ReadOnlyBanner({ role, plan }) {
  const ended = plan?.endsAt ? new Date(plan.endsAt) : null;
  const when = ended && ended < new Date() ? ` on ${ended.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 md:px-6" role="status">
      <b>Read-only:</b> the school&apos;s plan ended{when}. You can still look at everything, but changes are switched off until it&apos;s renewed.{" "}
      {role === "ADMIN" ? "Contact your provider to renew." : "Ask the school office."}
    </div>
  );
}

/** Shown instead of a page whose module isn't on the school's plan. */
function NotOnPlan({ module, role }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <School className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">{MODULE_NAME[module]} isn't on your school's plan</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {role === "ADMIN"
            ? "Upgrade the plan to use it. Your provider can switch it on from the subscription settings."
            : "Ask the school administrator if you need it."}
        </p>
        <Button asChild className="mt-5">
          <NavLink to="/app/dashboard">Back to the dashboard</NavLink>
        </Button>
      </div>
    </div>
  );
}

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

  // What the role may use, minus modules the school's plan doesn't include.
  const features = useMemo(() => ({ ...ALL_ON, ...(data?.features || {}) }), [data?.features]);
  const navItems = useMemo(() => {
    const base = NAV_BY_ROLE[role] || NAV_BY_ROLE.STUDENT;
    return filterByPlan(filterNavByCaps(role, base), features, role);
  }, [role, features]);

  const title = useMemo(() => getPageTitle(location.pathname, role), [location.pathname, role]);

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

  const logoSrc = toAbsUrl(brandingQ.data?.brandLogoUrl);
  const who = user?.teacher?.name || user?.student?.name || user?.email || "";

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Desktop sidebar: pinned to the screen; only its link list scrolls. */}
        <aside className="hidden lg:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r bg-card">
          <SchoolHeader logoSrc={logoSrc} schoolName={schoolName} role={role} />
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
            <GroupedNav items={navItems} />
          </nav>
          <AccountFooter who={who} role={role} logout={logout} />
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="h-12 ui-pad flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="lg:hidden">
                  <MobileNav navItems={navItems} role={role} schoolName={schoolName} logoSrc={logoSrc} who={who} logout={logout} />
                </div>
                <div className="text-base font-semibold truncate">{title}</div>
              </div>
              <div className="flex items-center gap-2">
                {["ADMIN", "TEACHER", "BURSAR"].includes(role) && <QuickSearch role={role} navItems={navItems} />}
                <div className="hidden xl:block text-sm text-muted-foreground truncate max-w-[200px]">{schoolName}</div>
                <Badge variant="outline" className="text-xs font-normal">
                  {ROLE_NAME[role] || role}
                </Badge>
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0">
            {data?.plan?.readOnly && role !== "SYSTEM_ADMIN" && <ReadOnlyBanner role={role} plan={data.plan} />}
            {(() => {
              const m = moduleOfPath(location.pathname);
              return m && features[m] === false ? <NotOnPlan module={m} role={role} /> : <Outlet />;
            })()}
          </main>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Sidebar parts
========================= */

const ROLE_NAME = {
  SYSTEM_ADMIN: "Platform owner",
  ADMIN: "Admin",
  TEACHER: "Teacher",
  BURSAR: "Bursar",
  STUDENT: "Learner",
  PARENT: "Parent",
};

const ICONS = {
  home: LayoutDashboard,
  notices: Megaphone,
  students: Users,
  classes: School,
  teachers: GraduationCap,
  attendance: CalendarCheck,
  exams: ClipboardList,
  results: BarChart3,
  reportCards: FileText,
  fees: Wallet,
  reports: PieChart,
  settings: Settings,
};

function SchoolHeader({ logoSrc, schoolName, role }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-4">
      {logoSrc ? (
        <img src={logoSrc} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain bg-muted" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">
          {initials(schoolName)}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-semibold leading-tight">{schoolName}</div>
        <div className="text-xs text-muted-foreground">{ROLE_NAME[role] || role}</div>
      </div>
    </div>
  );
}

function AccountFooter({ who, role, logout }) {
  return (
    <div className="border-t p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">
          {initials(who || role)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{who || ROLE_NAME[role]}</div>
          <div className="text-xs text-muted-foreground">{ROLE_NAME[role] || role}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Log out" aria-label="Log out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function initials(name) {
  const parts = String(name || "").replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "S";
}

/** Links under small group headings; a group heading only shows when there is more than one group. */
function GroupedNav({ items, onNavigate }) {
  const groups = NAV_GROUP_ORDER.map((g) => [g, items.filter((i) => (i.group || "Overview") === g)]).filter(([, list]) => list.length);
  const showHeadings = groups.length > 1;
  return (
    <div className="space-y-4">
      {groups.map(([group, list]) => (
        <div key={group}>
          {showHeadings && group !== "Overview" && (
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/80">{group}</div>
          )}
          <div className="space-y-0.5">
            {list.map((item) => (
              <NavItem key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NavItem({ item, onNavigate }) {
  const Icon = ICONS[item.icon] || LayoutDashboard;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/* =========================
   Mobile Nav
========================= */

function MobileNav({ navItems, role, schoolName, logoSrc, who, logout }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="px-3" aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <SchoolHeader logoSrc={logoSrc} schoolName={schoolName} role={role} />
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
          <GroupedNav items={navItems} onNavigate={() => setOpen(false)} />
        </nav>
        <AccountFooter who={who} role={role} logout={logout} />
      </SheetContent>
    </Sheet>
  );
}

// The logo is served by the API; turn its relative path into a full URL.
function toAbsUrl(path) {
  if (!path) return null;
  const v = String(path);
  if (/^https?:\/\//.test(v)) return v;
  const origin = String(api?.defaults?.baseURL || "").replace(/\/api\/?$/, "").replace(/\/$/, "");
  return `${origin}${v.startsWith("/") ? "" : "/"}${v}`;
}
