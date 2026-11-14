// School days and bell schedules. The school picks its days; each bell
// schedule ("school day") lists periods and breaks, and any period can run on
// some days only (a short Friday, games on Wednesday). Classes follow the
// default schedule unless put on another. Anything that would remove lessons
// says how many and asks first.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";

import { listClasses } from "@/api/classes.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowsSkeleton } from "@/components/ui/state-blocks";
import { getErrorMessage } from "@/lib/errors";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { DAY_NAMES, DAY_SHORT, deleteSchedule, getSetup, makeDefaultSchedule, minutes, saveDays, saveSchedule, setClassSchedule } from "./timetable.api";

const addMinutes = (t, n) => {
  const m = Math.min(23 * 60 + 59, minutes(t) + n);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const asksFirst = (e) => e?.response?.status === 409 && e.response.data?.code === "TIMETABLE_HAS_LESSONS";
const classLabel = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""}`;

/** "Go ahead and remove N lessons" box shown when the server asks first. */
function Confirm({ ask, onYes, onNo, busy }) {
  if (!ask) return null;
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
      <p className="font-medium text-destructive">{ask.message}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={onYes}>
          Go ahead and remove {ask.lessons} lesson{ask.lessons === 1 ? "" : "s"}
        </Button>
        <Button size="sm" variant="outline" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function BellTimes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timetable", "setup"], queryFn: getSetup });
  const refresh = () => qc.invalidateQueries({ queryKey: ["timetable"] });
  const [picked, setPicked] = useState(null);
  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError) return <p className="text-sm text-destructive">{getErrorMessage(q.error, "Couldn't load the school day.")}</p>;
  const setup = q.data;
  const current = picked === "new" ? null : setup.schedules.find((s) => s.id === picked) || setup.schedules[0];

  return (
    <div className="max-w-4xl space-y-5">
      <Days days={setup.days} onSaved={refresh} />
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {setup.schedules.map((s) => (
            <Button key={s.id} size="sm" variant={current?.id === s.id && picked !== "new" ? "default" : "outline"} onClick={() => setPicked(s.id)}>
              {s.isDefault && <Star className="h-3.5 w-3.5" />} {s.name}
            </Button>
          ))}
          <Button size="sm" variant={picked === "new" ? "default" : "ghost"} onClick={() => setPicked("new")}>
            <Plus className="h-4 w-4" /> New school day
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Most schools need one. Add another when some classes keep different times (e.g. lower primary goes home earlier). Classes follow the starred one unless moved below.
        </p>
        <ScheduleEditor
          key={picked === "new" ? "new" : current?.id}
          schedule={picked === "new" ? null : current}
          days={setup.days}
          onSaved={(saved) => {
            setPicked(saved?.id || null);
            refresh();
          }}
        />
      </section>
      {setup.schedules.length > 1 && <ClassSchedules schedules={setup.schedules} onSaved={refresh} />}
    </div>
  );
}

function Days({ days, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [ask, setAsk] = useState(null);
  const d = draft || days;
  const save = useMutation({
    mutationFn: (remove) => saveDays(d, remove),
    onSuccess: () => {
      setDraft(null);
      setAsk(null);
      toast.success("School days saved");
      onSaved();
    },
    onError: (e) => (asksFirst(e) ? setAsk(e.response.data) : toast.error(getErrorMessage(e, "Couldn't save"))),
  });
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">School days</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {[1, 2, 3, 4, 5, 6].map((day) => {
          const on = d.includes(day);
          return (
            <label key={day} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/5" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => setDraft(on ? d.filter((x) => x !== day) : [...d, day].sort((a, b) => a - b))} />
              {DAY_NAMES[day]}
            </label>
          );
        })}
        {draft && (
          <Button size="sm" onClick={() => save.mutate(false)} disabled={save.isPending}>
            Save days
          </Button>
        )}
      </div>
      <div className="mt-2">
        <Confirm ask={ask} busy={save.isPending} onYes={() => save.mutate(true)} onNo={() => setAsk(null)} />
      </div>
    </section>
  );
}

function ScheduleEditor({ schedule, days, onSaved }) {
  const blank = { name: "", periods: [{ label: "1", startsAt: "08:00", endsAt: "08:40", kind: "LESSON", days: [] }] };
  const [d, setD] = useState(() => (schedule ? { name: schedule.name, periods: schedule.periods.map((p) => ({ ...p })) } : blank));
  const [dirty, setDirty] = useState(!schedule);
  const [ask, setAsk] = useState(null);
  const edit = (fn) => {
    setAsk(null);
    setDirty(true);
    setD((cur) => fn(structuredClone(cur)));
  };
  const setRow = (i, k, v) => edit((x) => ((x.periods[i][k] = v), x));
  const save = useMutation({
    mutationFn: (remove) => saveSchedule(schedule?.id, { ...d, removeLessons: remove }),
    onSuccess: (saved) => {
      setDirty(false);
      setAsk(null);
      toast.success(saved.removedLessons ? `Saved; ${saved.removedLessons} lesson${saved.removedLessons === 1 ? "" : "s"} removed` : "School day saved");
      onSaved(saved);
    },
    onError: (e) => (asksFirst(e) ? setAsk(e.response.data) : toast.error(getErrorMessage(e, "Couldn't save the school day"))),
  });
  const del = useMutation({
    mutationFn: (remove) => deleteSchedule(schedule.id, remove),
    onSuccess: () => {
      toast.success("School day deleted; its classes follow the default");
      onSaved(null);
    },
    onError: (e) => (asksFirst(e) ? setAsk({ ...e.response.data, deleting: true }) : toast.error(getErrorMessage(e, "Couldn't delete"))),
  });
  const def = useMutation({ mutationFn: () => makeDefaultSchedule(schedule.id), onSuccess: () => onSaved(schedule), onError: (e) => toast.error(getErrorMessage(e, "Couldn't change")) });
  const addRow = (kind) =>
    edit((x) => {
      const last = x.periods[x.periods.length - 1];
      const start = last?.endsAt || "08:00";
      x.periods.push({ label: kind === "BREAK" ? "Break" : String(x.periods.filter((p) => p.kind === "LESSON").length + 1), startsAt: start, endsAt: addMinutes(start, kind === "BREAK" ? 20 : 40), kind, days: [] });
      return x;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input className="w-64" maxLength={40} value={d.name} placeholder="e.g. Lower primary" onChange={(e) => edit((x) => ((x.name = e.target.value), x))} />
        </label>
        {schedule && !schedule.isDefault && (
          <>
            <Button size="sm" variant="outline" onClick={() => def.mutate()} disabled={def.isPending}>
              <Star className="h-4 w-4" /> Make default
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(false)} disabled={del.isPending}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        )}
      </div>

      <div className="space-y-2">
        {d.periods.map((p, i) => (
          <div key={p.id || `n${i}`} className={`grid grid-cols-2 gap-2 rounded-lg p-1.5 sm:grid-cols-[1fr_6.5rem_6.5rem_7rem_auto_2.5rem] sm:items-center ${p.kind === "BREAK" ? "bg-muted/60" : ""}`}>
            <Input aria-label="Name" className="col-span-2 sm:col-span-1" value={p.label} maxLength={30} onChange={(e) => setRow(i, "label", e.target.value)} />
            <Input aria-label="Starts" type="time" value={p.startsAt} onChange={(e) => setRow(i, "startsAt", e.target.value)} />
            <Input aria-label="Ends" type="time" value={p.endsAt} onChange={(e) => setRow(i, "endsAt", e.target.value)} />
            <select aria-label="Type" className="h-10 rounded-md border bg-background px-2 text-sm" value={p.kind} onChange={(e) => setRow(i, "kind", e.target.value)}>
              <option value="LESSON">Lesson</option>
              <option value="BREAK">Break</option>
            </select>
            <div className="col-span-2 flex flex-wrap gap-1 sm:col-span-1" title="Days this period runs (none picked = every school day)">
              {days.map((day) => {
                const on = p.days?.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setRow(i, "days", on ? p.days.filter((x) => x !== day) : [...(p.days || []), day].sort((a, b) => a - b))}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${on ? "bg-primary text-primary-foreground" : p.days?.length ? "bg-muted text-muted-foreground line-through" : "bg-muted text-muted-foreground"}`}
                    aria-pressed={!!on}
                  >
                    {DAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${p.label}`} onClick={() => edit((x) => (x.periods.splice(i, 1), x))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Day buttons: leave all off for every school day, or pick the days a period runs (e.g. Clubs on Friday only).</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => addRow("LESSON")}>
          <Plus className="h-4 w-4" /> Lesson period
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => addRow("BREAK")}>
          <Plus className="h-4 w-4" /> Break
        </Button>
        <Button className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate(false)}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {schedule ? "Save school day" : "Create school day"}
        </Button>
      </div>
      <Confirm ask={ask} busy={save.isPending || del.isPending} onYes={() => (ask?.deleting ? del.mutate(true) : save.mutate(true))} onNo={() => setAsk(null)} />
    </div>
  );
}

function ClassSchedules({ schedules, onSaved }) {
  const { currentYear } = useSchoolCalendar();
  const classesQ = useQuery({ queryKey: ["classes", { timetable: true }], queryFn: () => listClasses({}) });
  const classes = useMemo(
    () => (classesQ.data || []).filter((c) => c.isActive !== false && Number(c.year) === Number(currentYear)).sort((a, b) => classLabel(a).localeCompare(classLabel(b), undefined, { numeric: true })),
    [classesQ.data, currentYear]
  );
  const scheduleOf = (c) => schedules.find((s) => s.classIds.includes(c.id))?.id || schedules.find((s) => s.isDefault)?.id;
  const [ask, setAsk] = useState(null);
  const move = useMutation({
    mutationFn: ({ classId, scheduleId, remove }) => setClassSchedule(classId, schedules.find((s) => s.id === scheduleId)?.isDefault ? null : scheduleId, remove),
    onSuccess: () => {
      setAsk(null);
      toast.success("Class moved to that school day");
      onSaved();
    },
    onError: (e, vars) => (asksFirst(e) ? setAsk({ ...e.response.data, vars }) : toast.error(getErrorMessage(e, "Couldn't move the class"))),
  });
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Which classes follow which school day</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {classes.map((c) => (
          <label key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
            {classLabel(c)}
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={scheduleOf(c)} onChange={(e) => move.mutate({ classId: c.id, scheduleId: e.target.value, remove: false })}>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-2">
        <Confirm ask={ask} busy={move.isPending} onYes={() => move.mutate({ ...ask.vars, remove: true })} onNo={() => setAsk(null)} />
      </div>
    </section>
  );
}
