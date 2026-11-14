// /app/timetable. What each role sees:
//   ADMIN    Classes (edit, auto-fill), Teachers (each teacher's week), Bell times
//   TEACHER  My week, and any class's week read-only
//   STUDENT  their class's week     PARENT  each child's class's week
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { listTeachers } from "@/api/teachers.api";
import { downloadFromApi } from "@/lib/download";
import { getErrorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/insights/Insights";
import { Button } from "@/components/ui/button";
import { RowsSkeleton } from "@/components/ui/state-blocks";

import WeekGrid from "./WeekGrid";
import ClassTimetable from "./ClassTimetable";
import BellTimes from "./BellTimes";
import { getMyTimetable, getTeacherTimetable, getToday } from "./timetable.api";

const TABS = {
  ADMIN: [
    ["classes", "Classes"],
    ["teachers", "Teachers"],
    ["bell", "Bell times"],
  ],
  TEACHER: [
    ["mine", "My week"],
    ["classes", "Classes"],
  ],
};

export default function TimetablePage() {
  const { data } = useMe();
  const role = String(data?.user?.role || "").toUpperCase();
  const tabs = TABS[role] || [];
  const [tab, setTab] = useState(null);
  const active = tab || tabs[0]?.[0] || "mine";
  const todayQ = useQuery({ queryKey: ["timetable", "today"], queryFn: getToday, staleTime: 60_000 });
  const today = todayQ.data?.schoolDay ? { day: todayQ.data.day, now: todayQ.data.now } : null;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow={role === "STUDENT" || role === "PARENT" ? "Learning" : "Teaching"}
        title="Timetable"
        subtitle={
          role === "ADMIN"
            ? "Set the school day, build each class's week, and check every teacher's load."
            : role === "TEACHER"
              ? "Your lessons this week, and any class's timetable."
              : "The week's lessons."
        }
      />
      {tabs.length > 1 && (
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-1" aria-label="Timetable sections">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              aria-current={active === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {active === "classes" && <ClassTimetable canEdit={role === "ADMIN"} today={today} />}
      {active === "bell" && role === "ADMIN" && <BellTimes />}
      {active === "teachers" && role === "ADMIN" && <TeachersView today={today} />}
      {active === "mine" && <MyTimetable today={today} />}
    </div>
  );
}

/** A teacher's week: which class, where, and how many lessons a day. */
function TeacherWeek({ t, today }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          <b>{t.totals.week}</b> lesson{t.totals.week === 1 ? "" : "s"} a week
        </span>
        <span className="text-muted-foreground">
          {t.days.map((d) => `${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]} ${t.totals.perDay[d] || 0}`).join(" · ")}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => downloadFromApi(`/api/timetable/teachers/${t.teacher.id}/pdf`, "timetable.pdf").catch(() => toast.error("Couldn't prepare the PDF."))}
        >
          <Download className="h-4 w-4" /> PDF
        </Button>
      </div>
      <WeekGrid
        days={t.days}
        periods={t.periods}
        lessons={t.lessons}
        subjects={t.subjects}
        lines={(l) => [l.class?.label, [l.subject?.name, l.room].filter(Boolean).join(" · ")]}
        today={today}
      />
    </div>
  );
}

function TeachersView({ today }) {
  const teachersQ = useQuery({ queryKey: ["teachers", "timetable"], queryFn: listTeachers, staleTime: 60_000 });
  const teachers = useMemo(
    () =>
      (teachersQ.data || [])
        .filter((u) => u.teacher?.id && u.isActive !== false)
        .map((u) => ({ id: u.teacher.id, name: `${u.teacher.firstName} ${u.teacher.lastName}`.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [teachersQ.data]
  );
  const [picked, setPicked] = useState("");
  const teacherId = picked || teachers[0]?.id || "";
  const q = useQuery({ queryKey: ["timetable", "teacher", teacherId], queryFn: () => getTeacherTimetable(teacherId), enabled: !!teacherId });

  return (
    <div className="space-y-4">
      <select aria-label="Teacher" className="h-10 min-w-[14rem] rounded-md border bg-background px-3 text-sm" value={teacherId} onChange={(e) => setPicked(e.target.value)}>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {q.isLoading && <RowsSkeleton rows={5} />}
      {q.isError && <p className="text-sm text-destructive">{getErrorMessage(q.error, "Couldn't load that timetable.")}</p>}
      {q.data && <TeacherWeek t={q.data} today={today} />}
    </div>
  );
}

function MyTimetable({ today }) {
  const q = useQuery({ queryKey: ["timetable", "me"], queryFn: getMyTimetable });
  if (q.isLoading) return <RowsSkeleton rows={5} />;
  if (q.isError) return <p className="text-sm text-destructive">{getErrorMessage(q.error, "Couldn't load your timetable.")}</p>;
  const t = q.data;
  if (t.kind === "teacher") return <TeacherWeek t={t} today={today} />;
  if (!t.learners?.length) return <p className="text-sm text-muted-foreground">No learner is linked to your account yet.</p>;
  return (
    <div className="space-y-8">
      {t.learners.map(({ learner, timetable }) => (
        <section key={learner.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {t.learners.length > 1 ? `${learner.name} · ` : ""}
              {timetable?.class?.label || "No class"}
            </h2>
            {timetable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadFromApi(`/api/timetable/classes/${timetable.class.id}/pdf`, "timetable.pdf").catch(() => toast.error("Couldn't prepare the PDF."))}
              >
                <Download className="h-4 w-4" /> PDF
              </Button>
            )}
          </div>
          {timetable ? (
            <WeekGrid
              days={timetable.days}
              periods={timetable.periods}
              lessons={timetable.lessons}
              subjects={timetable.subjects}
              lines={(l) => [l.subject?.name, [l.teacher?.name, l.room].filter(Boolean).join(" · ")]}
              today={today}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{learner.name} isn&apos;t in a class yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
