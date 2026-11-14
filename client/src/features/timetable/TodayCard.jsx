// Today at a glance: the caller's lessons today, with the one happening now
// and the next one marked. Teachers see their classes; learners and parents
// see each learner's class. Hidden on days with no lessons.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";

import { getToday, minutes } from "./timetable.api";

function LessonList({ lessons, now, lineOf }) {
  // Lessons carry their own times (classes can keep different school days).
  const rows = [...lessons].sort((a, b) => minutes(a.startsAt) - minutes(b.startsAt)).map((l) => ({ id: l.id, startsAt: l.startsAt, endsAt: l.endsAt, l }));
  const nowMin = minutes(now);
  const nextId = rows.find((p) => minutes(p.startsAt) > nowMin)?.id;
  return (
    <ol className="space-y-1.5">
      {rows.map((p) => {
        const l = p.l;
        const live = nowMin >= minutes(p.startsAt) && nowMin < minutes(p.endsAt);
        const done = nowMin >= minutes(p.endsAt);
        return (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${live ? "bg-primary/10 ring-1 ring-primary/40" : ""} ${done ? "opacity-55" : ""}`}
          >
            <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{p.startsAt}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{lineOf(l)[0]}</span>
              <span className="text-muted-foreground"> · {lineOf(l)[1]}</span>
            </span>
            {live && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">Now</span>}
            {!live && p.id === nextId && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Next</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function TodayCard({ className = "" }) {
  const q = useQuery({ queryKey: ["timetable", "today"], queryFn: getToday, staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const t = q.data;
  if (!t || !t.schoolDay) return null;
  const teacher = Array.isArray(t.lessons);
  const groups = teacher ? [{ key: "me", title: null, lessons: t.lessons }] : (t.learners || []).map((l) => ({ key: l.id, title: l.name, lessons: l.lessons }));
  if (!groups.some((g) => g.lessons.length)) return null;

  return (
    <section className={`rounded-2xl border bg-card p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="h-4 w-4 text-primary" /> Today, {t.dayName}
        </h2>
        <Link to="/app/timetable" className="text-sm font-medium text-primary hover:underline">
          Week
        </Link>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            {g.title && groups.length > 1 && <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>}
            {g.lessons.length ? (
              <LessonList
                lessons={g.lessons}
                now={t.now}
                lineOf={(l) => (teacher ? [l.class?.label, [l.subject?.name, l.room].filter(Boolean).join(" · ")] : [l.subject?.name, [l.teacher?.name, l.room].filter(Boolean).join(" · ")])}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No lessons today.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
