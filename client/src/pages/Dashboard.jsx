// src/pages/Dashboard.jsx
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { me } from "../api/auth.api";
import { getDashboardSummary, getDashboardActivity } from "@/api/dashboard.api";
import { api } from "@/api/axios";
import CurrentPlanPanel from "@/components/subscription/CurrentPlanPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

function fmtName(user) {
  const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return full || user?.email || user?.id || "—";
}

function money(n) {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(n));
  } catch {
    return String(n);
  }
}

function capLabel(cap) {
  if (cap === null) return "Unlimited";
  if (cap === undefined) return "—";
  return String(cap);
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function ProgressBar({ percent }) {
  const p = clampPct(percent);
  if (p == null) return null;
  return (
    <div className="h-2 w-full rounded bg-muted overflow-hidden">
      <div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}

function UsageMini({ label, used, cap, percent }) {
  const p = clampPct(percent);
  const danger = p != null && p >= 90;
  const warn = p != null && p >= 80 && p < 90;

  const badgeVariant = danger ? "destructive" : warn ? "secondary" : "outline";

  return (
    <div className="rounded-lg border bg-background p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Badge variant={badgeVariant} className="text-[10px] uppercase">
          {cap === null ? "Unlimited" : `${used ?? 0}/${cap ?? "—"}`}
        </Badge>
      </div>
      <div className="text-sm font-semibold">{used ?? 0}</div>
      <div className="text-[11px] text-muted-foreground">
        Cap: <span className="font-medium text-foreground">{capLabel(cap)}</span>
      </div>
      <ProgressBar percent={percent} />
    </div>
  );
}

// Role → module access (UX only; backend still enforces real security)
function canUseModule(role, moduleKey) {
  const r = String(role || "").toUpperCase();

  // SYSTEM_ADMIN is governance-only (no daily ops modules)
  if (r === "SYSTEM_ADMIN") return false;

  const RULES = {
    ATTENDANCE: ["ADMIN", "TEACHER"],
    EXAMS: ["ADMIN", "TEACHER"],
    REPORTS: ["ADMIN", "TEACHER"],
    STUDENTS: ["ADMIN", "TEACHER"],
    CLASSES: ["ADMIN"],
    FEES: ["ADMIN", "BURSAR"],
  };

  const allowed = RULES[moduleKey] || ["ADMIN"];
  return allowed.includes(r);
}

function ActivityItem({ item }) {
  const at = item?.at ? new Date(item.at).toLocaleString() : "—";
  const mod = item?.module || "SYSTEM";
  const actor = item?.actor || "System";
  const action = item?.action || "EVENT";

  const desc = (() => {
    if (mod === "ATTENDANCE") {
      if (action === "SUBMIT_SESSION") return "Submitted attendance session";
      if (action === "LOCK_SESSION") return "Locked attendance session";
      if (action === "UNLOCK_SESSION") return "Unlocked attendance session";
      if (action === "CREATE_RECORD") return "Created attendance record";
      if (action === "UPDATE_RECORD") return "Updated attendance record";
      return "Attendance activity";
    }
    if (mod === "FEES") {
      if (action === "PAYMENT_RECEIVED") return "Received a fee payment";
      return "Fees activity";
    }
    if (mod === "EXAMS") {
      if (action === "SESSION_CREATED") return "Created an exam session";
      return "Exams activity";
    }
    return "System activity";
  })();

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{desc}</div>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {mod}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {actor} • {at}
      </div>
      {item?.entity?.receiptNo ? (
        <div className="text-xs mt-1">
          Receipt: <span className="font-medium">{item.entity.receiptNo}</span>
        </div>
      ) : null}
    </div>
  );
}

function ActionCard({ to, label, badge, allowed }) {
  const cls =
    "group rounded-xl border bg-background p-4 transition " +
    (allowed
      ? "hover:bg-muted/40 hover:border-muted-foreground/20 cursor-pointer"
      : "opacity-60 cursor-not-allowed");

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className={allowed ? "font-medium group-hover:underline" : "font-medium"}>
          {label}
        </div>
        <div className="flex items-center gap-2">
          {!allowed ? (
            <Badge variant="outline" className="text-[10px] uppercase">
              No access
            </Badge>
          ) : null}
          <Badge variant="secondary" className="text-[10px] uppercase">
            {badge}
          </Badge>
        </div>
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        {allowed ? `Open ${label.toLowerCase()} module.` : "You don't have permission for this module."}
      </div>
    </>
  );

  return allowed ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls} role="button" aria-disabled="true" tabIndex={-1}>
      {inner}
    </div>
  );
}

async function fetchSubscriptionOverview() {
  const { data } = await api.get("/api/settings/subscription/overview");
  return data;
}

export default function Dashboard() {
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: me,
    retry: false,
    staleTime: 60 * 1000,
  });

  const user = meQ.data?.user ?? meQ.data;
  const role = user?.role || "—";
  const roleUpper = String(role || "").toUpperCase();
  const isGovOnly = roleUpper === "SYSTEM_ADMIN";

  const summaryQ = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: getDashboardSummary,
    retry: false,
    staleTime: 15 * 1000,
    enabled: !!user,
  });

  const activityQ = useQuery({
    queryKey: ["dashboardActivity", { limit: 20 }],
    queryFn: () => getDashboardActivity({ limit: 20 }),
    retry: false,
    staleTime: 10 * 1000,
    enabled: !!user,
  });

  // ✅ Current Plan panel (backend already exists)
  // Works for tenant users. For SYSTEM_ADMIN it only works if a school context is selected.
  const hasTenantHeader = !!localStorage.getItem("schoolId");
  const canLoadPlan = !!user && (!isGovOnly || hasTenantHeader);

  const planQ = useQuery({
    queryKey: ["subscriptionOverview", isGovOnly ? localStorage.getItem("schoolId") || "NO_SCOPE" : "TENANT"],
    queryFn: fetchSubscriptionOverview,
    enabled: canLoadPlan,
    retry: false,
    staleTime: 30 * 1000,
  });

  const quickActions = useMemo(() => {
    const base = [
      { to: "/app/attendance", label: "Take attendance", badge: "Daily", moduleKey: "ATTENDANCE" },
      { to: "/app/fees", label: "Receive payment", badge: "Money", moduleKey: "FEES" },
      { to: "/app/exams", label: "Enter marks", badge: "Academics", moduleKey: "EXAMS" },
      { to: "/app/reports", label: "Reports", badge: "Insights", moduleKey: "REPORTS" },
      { to: "/app/students", label: "Students", badge: "Core", moduleKey: "STUDENTS" },
      { to: "/app/classes", label: "Classes", badge: "Core", moduleKey: "CLASSES" },
    ];

    if (roleUpper === "TEACHER") {
      return base.filter((x) =>
        ["/app/attendance", "/app/exams", "/app/reports", "/app/students"].includes(x.to)
      );
    }
    return base;
  }, [roleUpper]);

  if (meQ.isLoading) return <div className="p-6">Loading dashboard…</div>;
  if (meQ.isError) return <div className="p-6">Failed to load dashboard.</div>;

  const summary = summaryQ.data;
  const activity = activityQ.data?.items || [];

  const studentsActive = summary?.counts?.studentsActive ?? 0;
  const classesCount = summary?.counts?.classesCount ?? 0;
  const teachersCount = summary?.counts?.teachersCount ?? 0;

  const att = summary?.attendanceToday;
  const fees = summary?.fees;
  const exams = summary?.exams?.latestSession;

  const canAttendance = canUseModule(role, "ATTENDANCE");
  const canFees = canUseModule(role, "FEES");
  const canReports = canUseModule(role, "REPORTS");
  const canExams = canUseModule(role, "EXAMS");

  const sub = planQ.data?.subscription || null;
  const usage = planQ.data?.usage || {};
  const pct = planQ.data?.percent || {};
  const flags = planQ.data?.flags || {};

  const writeEnabled = !!flags.canWrite;

  return (
    <div className="space-y-6 p-4">
      {/* HERO - Cleaned up but kept all content */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">Welcome, {fmtName(user)}</h1>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs font-normal">
                    {role}
                  </Badge>
                  {isGovOnly && (
                    <Badge variant="outline" className="text-xs font-normal">
                      Governance
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {isGovOnly
                  ? "Platform governance dashboard — tenant oversight, visibility, and control."
                  : "Your control room for daily ops — attendance, fees, exams, reports."}
              </p>

              {/* HERO BUTTONS - Same logic, cleaner spacing */}
              <div className="flex flex-wrap gap-2 pt-2">
                {isGovOnly ? (
                  <>
                    <Button asChild size="sm">
                      <Link to="/app/settings">Open settings</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/app/settings?tab=logs">Logs & monitoring</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild size="sm" disabled={!canAttendance}>
                      {canAttendance ? (
                        <Link to="/app/attendance">Take attendance</Link>
                      ) : (
                        <span>Take attendance</span>
                      )}
                    </Button>
                    <Button asChild variant="outline" size="sm" disabled={!canFees}>
                      {canFees ? (
                        <Link to="/app/fees">Receive payment</Link>
                      ) : (
                        <span>Receive payment</span>
                      )}
                    </Button>
                    <Button asChild variant="outline" size="sm" disabled={!canReports}>
                      {canReports ? (
                        <Link to="/app/reports">Open reports</Link>
                      ) : (
                        <span>Open reports</span>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Right side cards - Reorganized in a cleaner way */}
            <div className="lg:w-80 space-y-4">
              {/* System status card - Cleaned up */}
              <div className="rounded-lg border bg-muted/10 p-4">
                <div className="text-sm font-medium mb-2">System Status</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">API Status</span>
                  <Badge variant="outline" className="text-xs">
                    {summaryQ.isLoading ? "Loading…" : summaryQ.isError ? "Partial" : "Online"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Printing: <span className="text-foreground font-medium">Ready</span></div>
                  <div>Security: <span className="text-foreground font-medium">Role-gated</span></div>
                </div>
                <Separator className="my-3" />
                <div className="text-xs text-muted-foreground">
                  {isGovOnly ? "Keep tenants clean. Keep logs tighter." : "You're basically running a SaaS now. Keep it tight."}
                </div>
              </div>

              {/* Current Plan card - Simplified but kept all info */}
              {isGovOnly || !sub ? (
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium">Current Plan</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {planQ.isLoading ? "Loading…" : sub?.planCode || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={writeEnabled ? "secondary" : "outline"} className="text-xs">
                        {planQ.isLoading ? "…" : writeEnabled ? "WRITE" : "READ"}
                      </Badge>
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                        <Link to="/app/settings?tab=subs">Manage</Link>
                      </Button>
                    </div>
                  </div>
                  
                  {isGovOnly && !hasTenantHeader ? (
                    <div className="text-xs text-muted-foreground">
                      Select a school context to view plan usage.
                    </div>
                  ) : planQ.isError ? (
                    <div className="text-xs text-muted-foreground">
                      Couldn't load subscription overview.
                    </div>
                  ) : sub ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <UsageMini
                        label="Students"
                        used={usage.studentsCount ?? 0}
                        cap={sub.maxStudents}
                        percent={pct.students}
                      />
                      <UsageMini
                        label="Teachers"
                        used={usage.teachersCount ?? 0}
                        cap={sub.maxTeachers}
                        percent={pct.teachers}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - KPIs, Quick Actions, Attendance & Exams */}
        <div className="lg:col-span-2 space-y-6">
          {/* KPIs Grid - Cleaner layout */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Active students</div>
                <div className="text-2xl font-semibold">
                  {summaryQ.isLoading ? "…" : studentsActive}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Classes</div>
                <div className="text-2xl font-semibold">
                  {summaryQ.isLoading ? "…" : classesCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Teachers</div>
                <div className="text-2xl font-semibold">
                  {summaryQ.isLoading ? "…" : teachersCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Fees collected today</div>
                <div className="text-2xl font-semibold">
                  {summaryQ.isLoading ? "…" : money(fees?.collectedToday)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Receipts: {fees?.receiptsToday ?? "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Plan Panel for tenant users */}
          {!isGovOnly && <CurrentPlanPanel compact />}

          {/* Quick Actions - Only for non-Gov */}
          {!isGovOnly && (
            <Card>
              <CardHeader className="pb-3">
                <div>
                  <CardTitle className="text-base">Quick Actions</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">No hunting. Just execute.</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {quickActions.map((a) => (
                    <ActionCard
                      key={a.to}
                      to={a.to}
                      label={a.label}
                      badge={a.badge}
                      allowed={canUseModule(role, a.moduleKey)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Attendance & Exams Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Attendance Today</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Total sessions</span>
                    <span className="font-semibold">{att?.total ?? "—"}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2 bg-muted/20 rounded">
                      <div className="font-semibold">{att?.draft ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Draft</div>
                    </div>
                    <div className="text-center p-2 bg-muted/20 rounded">
                      <div className="font-semibold">{att?.submitted ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Submitted</div>
                    </div>
                    <div className="text-center p-2 bg-muted/20 rounded">
                      <div className="font-semibold">{att?.locked ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Locked</div>
                    </div>
                  </div>
                  {!isGovOnly && (
                    <>
                      <Separator />
                      <Button asChild className="w-full" disabled={!canAttendance}>
                        {canAttendance ? (
                          <Link to="/app/attendance">Open Attendance</Link>
                        ) : (
                          <span>Open Attendance</span>
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Latest Exam Session</CardTitle>
              </CardHeader>
              <CardContent>
                {!exams ? (
                  <div className="text-sm text-muted-foreground">No exam sessions found yet.</div>
                ) : (
                  <div className="space-y-3">
                    <div className="font-semibold">{exams.name || "Exam session"}</div>
                    <div className="text-xs text-muted-foreground">
                      {exams.term} • {exams.year} • {String(exams.status || "").toUpperCase()}
                    </div>
                    {!isGovOnly && (
                      <>
                        <Separator />
                        <Button asChild variant="outline" className="w-full" disabled={!canExams}>
                          {canExams ? (
                            <Link to="/app/exams">Open Exams</Link>
                          ) : (
                            <span>Open Exams</span>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Column - Activity Feed */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Activity</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => activityQ.refetch()}
                  disabled={activityQ.isLoading}
                >
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {activityQ.isLoading && (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Loading activity…
                </div>
              )}
              {activityQ.isError && (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Failed to load activity.
                </div>
              )}
              {!activityQ.isLoading && !activityQ.isError && activity.length === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No activity yet.
                </div>
              )}
              <div className="space-y-3">
                {activity.slice(0, 6).map((it) => (
                  <ActivityItem key={it.id} item={it} />
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
                This feed is audit-powered — it's the "what happened" timeline.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}