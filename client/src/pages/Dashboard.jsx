// src/pages/Dashboard.jsx
// The staff home. It opens with the figure that matters for the role (money
// for the bursar and admin, registers for a teacher), then what still needs
// doing today, then the trend and the activity feed. Learners and parents get
// their own home (features/portal), never this.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { me } from "../api/auth.api";
import { getDashboardSummary, getDashboardActivity } from "@/api/dashboard.api";
import { api } from "@/api/axios";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, PageSkeleton } from "@/components/ui/state-blocks";
import { PageHeader, Panel, HeroPanel, Ring, StatTile, Meter, BarList, ColumnChart, EmptyNote } from "@/components/insights/Insights";

const ROLE_LABELS = { SYSTEM_ADMIN: "Platform owner", ADMIN: "Admin", BURSAR: "Bursar", TEACHER: "Teacher" };

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};

function firstName(user) {
  const full = `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || user?.teacher?.name || "";
  return full.split(" ")[0] || ROLE_LABELS[String(user?.role || "").toUpperCase()] || "there";
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const longDate = (iso) => {
  try {
    return new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
};
const shortDay = (iso) => {
  try {
    return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
};

// What each role can open from here (the server enforces it; this keeps the
// page from offering doors that are locked).
const ACTIONS = {
  ADMIN: [
    { to: "/app/fees", label: "Receive payment", primary: true },
    { to: "/app/attendance", label: "Take attendance" },
    { to: "/app/notices", label: "Post a notice" },
    { to: "/app/reports", label: "Reports" },
  ],
  BURSAR: [
    { to: "/app/fees", label: "Receive payment", primary: true },
    { to: "/app/reports/fees/defaulters", label: "Who owes" },
    { to: "/app/reports", label: "Reports" },
  ],
  TEACHER: [
    { to: "/app/attendance", label: "Take attendance", primary: true },
    { to: "/app/exams", label: "Enter marks" },
    { to: "/app/report-cards", label: "Report cards" },
  ],
};

const ACTIVITY_TEXT = {
  ATTENDANCE: { SUBMIT_SESSION: "submitted a register", LOCK_SESSION: "locked a register", UNLOCK_SESSION: "unlocked a register", CREATE_RECORD: "marked attendance", UPDATE_RECORD: "changed attendance" },
  FEES: { PAYMENT_RECEIVED: "received a payment" },
  EXAMS: { SESSION_CREATED: "created an exam" },
};
const MODULE_DOT = { ATTENDANCE: "bg-sky-500", FEES: "bg-emerald-500", EXAMS: "bg-violet-500" };

function timeAgo(at) {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function Activity({ q }) {
  const items = q.data?.items || [];
  return (
    <Panel
      title="Recent activity"
      action={
        <Button variant="ghost" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          Refresh
        </Button>
      }
    >
      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <EmptyNote>Couldn&apos;t load activity.</EmptyNote>}
      {!q.isLoading && !q.isError && items.length === 0 && <EmptyNote>Nothing has happened yet today.</EmptyNote>}
      <ol className="space-y-3">
        {items.slice(0, 8).map((it) => {
          const verb = ACTIVITY_TEXT[it.module]?.[it.action] || "made a change";
          return (
            <li key={it.id} className="flex gap-3 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${MODULE_DOT[it.module] || "bg-slate-400"}`} aria-hidden="true" />
              <div className="min-w-0">
                <div>
                  <span className="font-medium">{it.actor || "System"}</span> {verb}
                  {it.entity?.receiptNo ? <span className="text-muted-foreground"> · {it.entity.receiptNo}</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{it.at ? timeAgo(it.at) : ""}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Registers({ att, compactView = false }) {
  if (!att || !att.classes) {
    return (
      <Panel title="Registers today">
        <EmptyNote>No classes to mark.</EmptyNote>
      </Panel>
    );
  }
  const pct = (att.registersDone / att.classes) * 100;
  const done = att.registersDone === att.classes;
  return (
    <Panel
      title="Registers today"
      subtitle={done ? "Every class is marked." : `${att.classes - att.registersDone} still to mark`}
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/app/attendance">Open attendance</Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-5">
        <Ring percent={pct} size={compactView ? 96 : 112} tone={done ? "good" : "primary"} label={`${att.registersDone} of ${att.classes} registers marked`}>
          <span className="text-2xl font-extrabold tabular-nums leading-none">
            {att.registersDone}
            <span className="text-sm font-semibold text-muted-foreground">/{att.classes}</span>
          </span>
          <span className="mt-1 text-xs text-muted-foreground">marked</span>
        </Ring>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          {att.ratePct != null ? (
            <>
              <div>
                <span className="text-2xl font-bold tabular-nums">{att.ratePct}%</span>{" "}
                <span className="text-muted-foreground">came in (present or late)</span>
              </div>
              <div className="text-muted-foreground">
                {att.present} present · {att.late} late · <span className={att.absent ? "font-semibold text-red-700 dark:text-red-400" : ""}>{att.absent} absent</span>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">No one has been marked yet today.</div>
          )}
        </div>
      </div>
      {att.notMarked?.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Still to mark</div>
          <div className="flex flex-wrap gap-2">
            {att.notMarked.map((c) => (
              <Link key={c.classId} to="/app/attendance" className="rounded-full border px-3 py-1 text-sm hover:border-primary hover:text-primary">
                {c.label}
              </Link>
            ))}
            {att.classes - att.registersDone > att.notMarked.length && (
              <span className="px-1 py-1 text-sm text-muted-foreground">+{att.classes - att.registersDone - att.notMarked.length} more</span>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function FeesHero({ fees, termLabel }) {
  const t = fees.term;
  if (!t || !t.invoices) {
    return (
      <HeroPanel eyebrow="Fees" value={kes(fees.collectedToday)} caption={`collected today · ${fees.receiptsToday} receipt${fees.receiptsToday === 1 ? "" : "s"}`} minis={[{ label: "Outstanding", value: kes(fees.outstandingTotal), alert: fees.outstandingTotal > 0 }]} />
    );
  }
  return (
    <HeroPanel
      eyebrow={`Collected · ${termLabel}`}
      value={kes(t.paid)}
      caption={`of ${kes(t.billed)} billed on ${t.invoices.toLocaleString()} invoice${t.invoices === 1 ? "" : "s"}`}
      minis={[
        { label: "Still owed", value: kes(t.balance), alert: t.balance > 0 },
        { label: "Today", value: kes(fees.collectedToday) },
        { label: "Receipts today", value: fees.receiptsToday.toLocaleString() },
        { label: "Fully paid", value: `${t.fullyPaid.toLocaleString()} of ${t.invoices.toLocaleString()}` },
      ]}
      aside={
        <Ring percent={t.percent} size={136} stroke={14} tone={t.percent >= 100 ? "good" : "#ffffff"} track="rgba(255,255,255,0.18)" label={`${t.percent}% of term fees collected`}>
          <span className="text-3xl font-extrabold tabular-nums leading-none">{Math.round(t.percent)}%</span>
          <span className="mt-1 text-xs text-white/75 print:text-black/70">collected</span>
        </Ring>
      }
    />
  );
}

function FeesTrend({ fees }) {
  const trend = fees.trend || [];
  const total = trend.reduce((n, d) => n + d.amount, 0);
  return (
    <Panel
      title="Collections, last 14 days"
      subtitle={`${kes(total)} in ${trend.reduce((n, d) => n + d.receipts, 0)} receipts`}
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/reports/fees/collections">Details</Link>
        </Button>
      }
    >
      <ColumnChart
        points={trend.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.amount, display: kes(d.amount) }))}
        ariaLabel="Fees collected each day for the last 14 days"
        empty="No payments in the last 14 days."
        highlightLast
      />
    </Panel>
  );
}

function OwedByClass({ fees }) {
  const rows = fees.byClass || [];
  return (
    <Panel
      title="Most owed, by class"
      subtitle="This term's unpaid balances"
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/reports/fees/defaulters">Who owes</Link>
        </Button>
      }
    >
      <BarList
        tone="alert"
        empty="Nothing owed this term."
        items={rows.map((c) => ({
          key: c.classId,
          label: c.label,
          value: c.balance,
          display: kes(c.balance),
          sub: c.billed ? `${Math.round((c.balance / c.billed) * 100)}% unpaid` : null,
        }))}
      />
    </Panel>
  );
}

function LatestExam({ exam, termLabels, canOpen }) {
  return (
    <Panel title="Latest exam">
      {!exam ? (
        <EmptyNote>No exams yet.</EmptyNote>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="font-semibold">{exam.name || "Exam"}</div>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {termLabels?.[exam.term] || exam.term} {exam.year}
            <Badge variant={exam.status === "PUBLISHED" ? "secondary" : "outline"} className="text-[10px] uppercase">
              {String(exam.status || "").toLowerCase()}
            </Badge>
          </div>
          {canOpen && (
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link to={exam.status === "PUBLISHED" ? "/app/results" : "/app/exams"}>{exam.status === "PUBLISHED" ? "See results" : "Open exam"}</Link>
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function PlanCard({ planQ }) {
  const sub = planQ.data?.subscription;
  const usage = planQ.data?.usage || {};
  const pct = planQ.data?.percent || {};
  return (
    <Panel
      title="Plan"
      subtitle={planQ.isLoading ? "Loading…" : sub?.planCode || "—"}
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/settings?tab=subs">Manage</Link>
        </Button>
      }
    >
      {planQ.isError && <div className="text-sm text-muted-foreground">Couldn&apos;t load the plan.</div>}
      {sub && (
        <div className="space-y-3 text-sm">
          {[
            ["Students", usage.studentsCount, sub.maxStudents, pct.students],
            ["Teachers", usage.teachersCount, sub.maxTeachers, pct.teachers],
          ].map(([label, used, cap, p]) => (
            <div key={label}>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">
                  {used ?? 0}
                  {cap == null ? "" : ` of ${cap}`}
                </span>
              </div>
              {cap != null && <Meter percent={p} tone={p >= 90 ? "alert" : p >= 80 ? "warn" : "primary"} className="mt-1" />}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function Dashboard() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: me, retry: false, staleTime: 60 * 1000 });
  const user = meQ.data?.user ?? meQ.data;
  const role = String(user?.role || "").toUpperCase();
  const isOwner = role === "SYSTEM_ADMIN";
  const { termLabels } = useSchoolCalendar();

  const summaryQ = useQuery({ queryKey: ["dashboardSummary"], queryFn: getDashboardSummary, retry: false, staleTime: 15 * 1000, enabled: !!user });
  const activityQ = useQuery({
    queryKey: ["dashboardActivity", { limit: 20 }],
    queryFn: () => getDashboardActivity({ limit: 20 }),
    retry: false,
    staleTime: 10 * 1000,
    enabled: !!user && !isOwner,
  });
  const hasSchool = !!localStorage.getItem("schoolId");
  const planQ = useQuery({
    queryKey: ["subscriptionOverview", isOwner ? localStorage.getItem("schoolId") || "NO_SCOPE" : "TENANT"],
    queryFn: () => api.get("/api/settings/subscription/overview").then((r) => r.data),
    enabled: !!user && (role === "ADMIN" || (isOwner && hasSchool)),
    retry: false,
    staleTime: 30 * 1000,
  });

  if (meQ.isLoading) return <PageSkeleton />;
  if (meQ.isError) {
    return (
      <div className="p-6">
        <ErrorState title="Failed to load dashboard" message={meQ.error?.response?.data?.message || meQ.error?.message} onRetry={() => meQ.refetch()} />
      </div>
    );
  }

  const s = summaryQ.data;
  const cal = s?.calendar;
  const termLabel = cal?.term ? `${termLabels?.[cal.term] || cal.term} ${cal.year}` : cal?.year ? String(cal.year) : "";
  const eyebrow = [cal?.today ? longDate(cal.today) : null, termLabel || null].filter(Boolean).join(" · ");
  const counts = s?.counts || {};
  const fees = s?.fees;
  const att = s?.attendanceToday;
  const canAttendance = role === "ADMIN" || role === "TEACHER";

  if (isOwner) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          eyebrow="Platform"
          title={`${greeting()}, ${firstName(user)}`}
          subtitle="Schools, plans and the audit trail across the platform."
          actions={
            <>
              <Button asChild size="sm">
                <Link to="/app/settings">Open settings</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/app/settings?tab=logs">Logs</Link>
              </Button>
            </>
          }
        />
        {hasSchool ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Active learners" value={summaryQ.isLoading ? "…" : (counts.studentsActive ?? 0).toLocaleString()} />
            <StatTile label="Classes" value={summaryQ.isLoading ? "…" : counts.classesCount ?? 0} />
            <StatTile label="Teachers" value={summaryQ.isLoading ? "…" : counts.teachersCount ?? 0} />
          </div>
        ) : (
          <EmptyNote>Choose a school in Settings to see its figures.</EmptyNote>
        )}
        {hasSchool && <PlanCard planQ={planQ} />}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow={eyebrow}
        title={`${greeting()}, ${firstName(user)}`}
        actions={(ACTIONS[role] || []).map((a) => (
          <Button key={a.to} asChild size="sm" variant={a.primary ? "default" : "outline"}>
            <Link to={a.to}>{a.label}</Link>
          </Button>
        ))}
      />

      {summaryQ.isError && (
        <ErrorState bare title="Couldn't load today's figures" message={summaryQ.error?.response?.data?.message} onRetry={() => summaryQ.refetch()} />
      )}
      {summaryQ.isLoading && <div className="h-48 animate-pulse rounded-3xl bg-muted" />}

      {s && fees && <FeesHero fees={fees} termLabel={termLabel || "this term"} />}

      {s && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {canAttendance && <Registers att={att} />}
            {fees && <FeesTrend fees={fees} />}
            {fees && <OwedByClass fees={fees} />}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Active learners" value={(counts.studentsActive ?? 0).toLocaleString()} to={role === "BURSAR" ? undefined : "/app/students"} />
              <StatTile label="Classes" value={counts.classesCount ?? 0} to={role === "ADMIN" ? "/app/classes" : undefined} />
              <StatTile label="Teachers" value={counts.teachersCount ?? 0} to={role === "ADMIN" ? "/app/teachers" : undefined} />
            </div>
          </div>
          <div className="space-y-6">
            {/* Only when it adds something: other terms' arrears on top of this term's. */}
            {fees && fees.outstandingTotal > 0 && fees.outstandingTotal !== fees.term?.balance && (
              <StatTile label="Owed across all terms" value={compact(fees.outstandingTotal)} hint={`${kes(fees.outstandingTotal)} on ${fees.invoicesCount} invoices`} tone="alert" to="/app/reports/fees/defaulters" />
            )}
            {role !== "BURSAR" && <LatestExam exam={s.exams?.latestSession} termLabels={termLabels} canOpen={role === "ADMIN" || role === "TEACHER"} />}
            <Activity q={activityQ} />
            {role === "ADMIN" && <PlanCard planQ={planQ} />}
          </div>
        </div>
      )}
    </div>
  );
}
