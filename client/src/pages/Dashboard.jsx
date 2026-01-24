// src/pages/Dashboard.jsx
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { me } from "../api/auth.api";
import { getDashboardSummary, getDashboardActivity } from "@/api/dashboard.api";

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
        {allowed ? `Open ${label.toLowerCase()} module.` : "You don’t have permission for this module."}
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

  const quickActions = useMemo(() => {
    const base = [
      { to: "/app/attendance", label: "Take attendance", badge: "Daily", moduleKey: "ATTENDANCE" },
      { to: "/app/fees", label: "Receive payment", badge: "Money", moduleKey: "FEES" },
      { to: "/app/exams", label: "Enter marks", badge: "Academics", moduleKey: "EXAMS" },
      { to: "/app/reports", label: "Reports", badge: "Insights", moduleKey: "REPORTS" },
      { to: "/app/students", label: "Students", badge: "Core", moduleKey: "STUDENTS" },
      { to: "/app/classes", label: "Classes", badge: "Core", moduleKey: "CLASSES" },
    ];

    // Teacher view: keep it lean
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

  return (
    <div className="space-y-6">
      {/* HERO */}
      <Card className="overflow-hidden">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">Welcome, {fmtName(user)}</h1>
                <Badge variant="secondary" className="uppercase text-[10px]">
                  {role}
                </Badge>

                {isGovOnly ? (
                  <Badge variant="outline" className="uppercase text-[10px]">
                    Governance mode
                  </Badge>
                ) : null}
              </div>

              <p className="text-sm text-muted-foreground">
                {isGovOnly
                  ? "Platform governance dashboard — tenant oversight, visibility, and control."
                  : "Your control room for daily ops — attendance, fees, exams, reports."}
              </p>

              {/* HERO BUTTONS */}
              {isGovOnly ? (
                <div className="pt-3 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to="/app/settings">Open settings</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/app/settings?tab=logs">Logs & monitoring</Link>
                  </Button>
                </div>
              ) : (
                <div className="pt-3 flex flex-wrap gap-2">
                  <Button asChild disabled={!canAttendance}>
                    {canAttendance ? (
                      <Link to="/app/attendance">Take attendance</Link>
                    ) : (
                      <span>Take attendance</span>
                    )}
                  </Button>

                  <Button asChild variant="outline" disabled={!canFees}>
                    {canFees ? (
                      <Link to="/app/fees">Receive payment</Link>
                    ) : (
                      <span>Receive payment</span>
                    )}
                  </Button>

                  <Button asChild variant="outline" disabled={!canReports}>
                    {canReports ? (
                      <Link to="/app/reports">Open reports</Link>
                    ) : (
                      <span>Open reports</span>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-muted/20 p-4 min-w-[280px]">
              <div className="text-xs text-muted-foreground">System status</div>
              <div className="mt-1 font-semibold">
                {summaryQ.isLoading ? "Loading…" : summaryQ.isError ? "Partial" : "Online"}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Printing: <span className="text-foreground font-medium">Ready</span> • Security:{" "}
                <span className="text-foreground font-medium">Role-gated</span>
              </div>
              <Separator className="my-3" />
              <div className="text-xs text-muted-foreground">
                {isGovOnly ? "Keep tenants clean. Keep logs tighter." : "You’re basically running a SaaS now. Keep it tight."}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Active students</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQ.isLoading ? "…" : studentsActive}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Classes</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQ.isLoading ? "…" : classesCount}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Teachers</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQ.isLoading ? "…" : teachersCount}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Fees collected today</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQ.isLoading ? "…" : money(fees?.collectedToday)}
          </CardContent>
          <div className="px-6 pb-4 text-xs text-muted-foreground">
            Receipts: {fees?.receiptsToday ?? "—"}
          </div>
        </Card>
      </div>

      {/* Quick actions (HIDDEN for SYSTEM_ADMIN) */}
      {!isGovOnly ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Quick actions</div>
              <div className="text-sm text-muted-foreground">No hunting. Just execute.</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        </>
      ) : null}

      {/* Attendance + Exams + Activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Attendance today (HIDDEN button for SYSTEM_ADMIN) */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Attendance today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total sessions</span>
              <span className="font-semibold">{att?.total ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Draft</span>
              <span className="font-semibold">{att?.draft ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Submitted</span>
              <span className="font-semibold">{att?.submitted ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Locked</span>
              <span className="font-semibold">{att?.locked ?? "—"}</span>
            </div>

            {!isGovOnly ? (
              <>
                <Separator />
                <Button asChild className="w-full" disabled={!canAttendance}>
                  {canAttendance ? (
                    <Link to="/app/attendance">Open attendance</Link>
                  ) : (
                    <span>Open attendance</span>
                  )}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Exams (HIDDEN button for SYSTEM_ADMIN) */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latest exam session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!exams ? (
              <div className="text-sm text-muted-foreground">No exam sessions found yet.</div>
            ) : (
              <>
                <div className="font-semibold">{exams.name || "Exam session"}</div>
                <div className="text-xs text-muted-foreground">
                  {exams.term} • {exams.year} • {String(exams.status || "").toUpperCase()}
                </div>
              </>
            )}

            {!isGovOnly ? (
              <>
                <Separator />
                <Button asChild variant="outline" className="w-full" disabled={!canExams}>
                  {canExams ? <Link to="/app/exams">Open exams</Link> : <span>Open exams</span>}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Recent activity</span>
              <Button variant="outline" size="sm" onClick={() => activityQ.refetch()}>
                Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activityQ.isLoading && (
              <div className="text-sm text-muted-foreground">Loading activity…</div>
            )}
            {activityQ.isError && (
              <div className="text-sm text-muted-foreground">Failed to load activity.</div>
            )}
            {!activityQ.isLoading && !activityQ.isError && activity.length === 0 && (
              <div className="text-sm text-muted-foreground">No activity yet.</div>
            )}
            {activity.slice(0, 6).map((it) => (
              <ActivityItem key={it.id} item={it} />
            ))}
            <Separator />
            <div className="text-xs text-muted-foreground">
              This feed is audit-powered — it’s the “what happened” timeline.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
