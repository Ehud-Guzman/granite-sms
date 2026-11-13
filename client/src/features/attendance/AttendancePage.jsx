// Attendance: open today's register for a class, and look back over recent
// registers week by week, with how many were present in each and, for one
// class, the school days nobody took a register.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, Loader2 } from "lucide-react";

import { listClasses } from "@/api/classes.api";
import { createOrOpenAttendanceSession, listAttendanceSessions } from "@/api/attendance.api";
import { getErrorMessage } from "@/lib/errors";
import { useCurrentTermState, useSchoolCalendar } from "@/lib/schoolCalendar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Meter } from "@/components/insights/Insights";

const WEEKS_STEP = 4;
const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "DRAFT", label: "Open" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "LOCKED", label: "Locked" },
];
const STATUS_STYLE = {
  DRAFT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUBMITTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  LOCKED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};
const STATUS_WORD = { DRAFT: "open", SUBMITTED: "submitted", LOCKED: "locked" };

const classLabel = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""}` : "Class");
const asList = (raw) => (Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []);

/** "YYYY-MM-DD" n days from a date string. */
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const weekday = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const mondayOf = (day) => addDays(day, -weekday(day));
const fmtDay = (day, opts) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { timeZone: "UTC", ...opts });

/** Present (on time or late) out of everyone on the register. */
function presence(counts = {}) {
  const present = (counts.PRESENT || 0) + (counts.LATE || 0);
  const total = counts.total || 0;
  return { present, total, absent: counts.ABSENT || 0, unmarked: counts.UNMARKED || 0, pct: total ? Math.round((present / total) * 100) : null };
}

export default function AttendancePage() {
  const { today, currentTermDates } = useSchoolCalendar();
  const nav = useNavigate();
  const qc = useQueryClient();

  // ---- Taking a register ----
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState("");
  const day = date || today;
  const [term, setTerm] = useCurrentTermState();

  const classesQ = useQuery({ queryKey: ["classes", { year: null }], queryFn: () => listClasses({}), staleTime: 60 * 1000 });
  const classes = useMemo(() => asList(classesQ.data).filter((c) => c.isActive !== false), [classesQ.data]);

  const open = useMutation({
    mutationFn: createOrOpenAttendanceSession,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["attendanceSessions"] });
      const id = data?.session?.id || data?.id;
      if (id) nav(`/app/attendance/${id}`);
    },
  });

  // ---- Looking back ----
  const [filterClass, setFilterClass] = useState("");
  const [status, setStatus] = useState("");
  const [weeks, setWeeks] = useState(WEEKS_STEP);
  const from = addDays(mondayOf(today), -7 * (weeks - 1));

  const sessionsQ = useQuery({
    queryKey: ["attendanceSessions", { classId: filterClass || null, from, to: today, status: status || null }],
    queryFn: () => listAttendanceSessions({ classId: filterClass || undefined, from, to: today, status: status || undefined }),
    placeholderData: (prev) => prev,
    staleTime: 10 * 1000,
  });
  const sessions = asList(sessionsQ.data);

  // Week -> day -> registers. With one class picked (and no status filter),
  // school days in term with no register show up as gaps.
  const weeksList = useMemo(() => {
    const byDay = new Map();
    for (const s of sessions) {
      const d = String(s.date).slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(s);
    }
    const showGaps = !!filterClass && !status;
    const inTerm = (d) => !currentTermDates || (d >= currentTermDates.startsOn && d <= currentTermDates.endsOn);
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const monday = addDays(mondayOf(today), -7 * w);
      const days = [];
      for (let i = 4; i >= 0; i--) {
        const d = addDays(monday, i);
        if (d > today) continue;
        const regs = (byDay.get(d) || []).sort((a, b) => classLabel(a.class).localeCompare(classLabel(b.class), undefined, { numeric: true }));
        if (regs.length || (showGaps && inTerm(d))) days.push({ day: d, regs, missing: showGaps && !regs.length });
      }
      // Weekend registers, if any were taken.
      for (const d of [addDays(monday, 6), addDays(monday, 5)]) if (byDay.has(d)) days.unshift({ day: d, regs: byDay.get(d), missing: false });
      const regs = days.flatMap((x) => x.regs);
      const tot = regs.reduce((a, s) => a + presence(s.counts).total, 0);
      const pre = regs.reduce((a, s) => a + presence(s.counts).present, 0);
      out.push({ monday, days, count: regs.length, missing: days.filter((x) => x.missing).length, pct: tot ? Math.round((pre / tot) * 100) : null });
    }
    return out;
  }, [sessions, weeks, today, filterClass, status, currentTermDates]);

  const anything = weeksList.some((w) => w.days.length);

  // This week is open; earlier weeks show as one summary line until opened.
  const [shownWeeks, setShownWeeks] = useState(() => new Set([mondayOf(today)]));
  const toggleWeek = (monday) =>
    setShownWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(monday)) next.delete(monday);
      else next.add(monday);
      return next;
    });

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader eyebrow="Teaching" title="Attendance" subtitle="Take the register each morning, then look back over the weeks." />

      {/* Take a register */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Take a register</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[12rem] flex-1 gap-1 text-sm sm:flex-none">
            <span className="text-xs text-muted-foreground">Class</span>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={classesQ.isLoading}
            >
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)} ({c.year})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Day</span>
            <Input type="date" className="h-10 w-auto" value={day} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
          {/* With term dates set, the server works the term out from the day. */}
          {!currentTermDates && (
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Term</span>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={term} onChange={(e) => setTerm(e.target.value)}>
                <option value="TERM1">Term 1</option>
                <option value="TERM2">Term 2</option>
                <option value="TERM3">Term 3</option>
              </select>
            </label>
          )}
          <Button
            className="h-10"
            disabled={!classId || open.isPending}
            onClick={() => open.mutate({ classId, date: day, year: Number(day.slice(0, 4)), term })}
          >
            {open.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Open register
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {day === today ? "Today's" : `${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}'s`} register. If it&apos;s already started, this opens it.
        </p>
        {open.isError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{getErrorMessage(open.error, "Couldn't open the register.")}</div>
        )}
      </section>

      {/* Looking back */}
      <Panel
        title="Registers"
        subtitle={`Since ${fmtDay(from, { day: "numeric", month: "short" })}`}
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select
              aria-label="Filter by class"
              className="h-9 min-w-[9rem] flex-1 rounded-md border bg-background px-2 text-sm sm:flex-none"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {STATUS_TABS.map((t) => (
                <Button key={t.key || "all"} size="sm" variant={status === t.key ? "default" : "outline"} onClick={() => setStatus(t.key)}>
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        }
      >
        {sessionsQ.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading registers…
          </div>
        ) : sessionsQ.isError ? (
          <div className="py-6 text-sm text-destructive">{getErrorMessage(sessionsQ.error, "Couldn't load registers.")}</div>
        ) : !anything ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No registers in these weeks{filterClass ? " for this class" : ""}.
          </div>
        ) : (
          <div className="space-y-5">
            {weeksList
              .filter((w) => w.days.length)
              .map((w) => {
                const isOpen = shownWeeks.has(w.monday);
                return (
                <div key={w.monday}>
                  <button
                    type="button"
                    onClick={() => toggleWeek(w.monday)}
                    aria-expanded={isOpen}
                    className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 border-b pb-1.5 text-left hover:text-primary"
                  >
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                      <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      {w.monday === mondayOf(today) ? "This week" : `Week of ${fmtDay(w.monday, { day: "numeric", month: "short" })}`}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {w.count} register{w.count === 1 ? "" : "s"}
                      {w.pct !== null && ` · ${w.pct}% present`}
                      {w.missing > 0 && <span className="font-medium text-amber-700 dark:text-amber-400"> · {w.missing} day{w.missing === 1 ? "" : "s"} missed</span>}
                    </span>
                  </button>
                  {isOpen && (
                  <div className="space-y-3">
                    {w.days.map((d) => (
                      <div key={d.day} className="grid gap-1.5 sm:grid-cols-[7.5rem_1fr]">
                        <div className="pt-2 text-xs font-medium text-muted-foreground">
                          {d.day === today ? "Today" : fmtDay(d.day, { weekday: "short", day: "numeric", month: "short" })}
                        </div>
                        <div className="grid gap-1.5">
                          {d.missing && (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                              No register taken
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={open.isPending}
                                onClick={() => open.mutate({ classId: filterClass, date: d.day, year: Number(d.day.slice(0, 4)), term })}
                              >
                                Take it now
                              </Button>
                            </div>
                          )}
                          {d.regs.map((s) => {
                            const p = presence(s.counts);
                            const tone = p.pct === null ? "primary" : p.pct >= 90 ? "good" : p.pct >= 75 ? "warn" : "alert";
                            return (
                              <Link
                                key={s.id}
                                to={`/app/attendance/${s.id}`}
                                className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 transition hover:border-primary/50 hover:bg-muted/40 sm:gap-4"
                              >
                                <span className="min-w-0 flex-1 truncate font-medium sm:w-28 sm:flex-none">{classLabel(s.class)}</span>
                                <span className="flex items-center gap-2 sm:min-w-[10rem] sm:flex-1">
                                  <Meter percent={p.pct || 0} tone={tone} className="hidden h-1.5 max-w-40 flex-1 sm:block" />
                                  <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                                    {p.total ? `${p.present}/${p.total}` : "no learners"}
                                    <span className="hidden sm:inline">
                                      {p.total ? " present" : ""}
                                      {p.absent ? ` · ${p.absent} absent` : ""}
                                      {p.unmarked ? ` · ${p.unmarked} not marked` : ""}
                                    </span>
                                    {p.absent ? <span className="text-red-600 sm:hidden"> · {p.absent} out</span> : null}
                                  </span>
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[s.status] || "bg-muted"}`}>
                                  {STATUS_WORD[s.status] || String(s.status).toLowerCase()}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
                );
              })}
          </div>
        )}
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" disabled={sessionsQ.isFetching} onClick={() => setWeeks((n) => n + WEEKS_STEP)}>
            {sessionsQ.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
            Show {WEEKS_STEP} earlier weeks
          </Button>
        </div>
      </Panel>
    </div>
  );
}
