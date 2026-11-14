// The school day: periods with their times, breaks, and which days the
// timetable runs. Saving keeps each existing period (and its lessons); if a
// change would remove lessons, the screen says how many and asks first.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowsSkeleton } from "@/components/ui/state-blocks";
import { getErrorMessage } from "@/lib/errors";
import { DAY_NAMES, getSetup, minutes, saveSetup } from "./timetable.api";

const addMinutes = (t, n) => {
  const m = Math.min(23 * 60 + 59, minutes(t) + n);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export default function BellTimes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timetable", "setup"], queryFn: getSetup });
  const [draft, setDraft] = useState(null);
  const [confirm, setConfirm] = useState(null); // { lessons, message }
  const d = draft || (q.data ? { days: q.data.days, periods: q.data.periods.map((p) => ({ ...p })) } : null);
  const dirty = !!draft;

  const save = useMutation({
    mutationFn: (removeLessons) => saveSetup({ days: d.days, periods: d.periods, removeLessons }),
    onSuccess: (saved) => {
      qc.setQueryData(["timetable", "setup"], (old) => ({ ...(old || {}), ...saved }));
      qc.invalidateQueries({ queryKey: ["timetable"] });
      setDraft(null);
      setConfirm(null);
      toast.success(saved.removedLessons ? `School day saved; ${saved.removedLessons} lesson${saved.removedLessons === 1 ? "" : "s"} removed` : "School day saved");
    },
    onError: (e) => {
      if (e?.response?.status === 409 && e.response.data?.code === "TIMETABLE_HAS_LESSONS") {
        setConfirm({ lessons: e.response.data.lessons, message: e.response.data.message });
      } else toast.error(getErrorMessage(e, "Couldn't save the school day"));
    },
  });

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError) return <p className="text-sm text-destructive">{getErrorMessage(q.error, "Couldn't load the school day.")}</p>;

  const edit = (fn) => {
    setConfirm(null);
    setDraft((cur) => fn(structuredClone(cur || d)));
  };
  const setRow = (i, k, v) => edit((x) => ((x.periods[i][k] = v), x));
  const sortByTime = () => edit((x) => ((x.periods = [...x.periods].sort((a, b) => minutes(a.startsAt) - minutes(b.startsAt))), x));
  const addRow = (kind) =>
    edit((x) => {
      const last = x.periods[x.periods.length - 1];
      const start = last?.endsAt || "08:00";
      const n = x.periods.filter((p) => p.kind === "LESSON").length + 1;
      x.periods.push({ label: kind === "BREAK" ? "Break" : String(n), startsAt: start, endsAt: addMinutes(start, kind === "BREAK" ? 20 : 40), kind });
      return x;
    });

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">School days</h3>
        <p className="mb-3 text-xs text-muted-foreground">The days the timetable runs.</p>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6].map((day) => {
            const on = d.days.includes(day);
            return (
              <label key={day} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/5" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => edit((x) => ((x.days = on ? x.days.filter((y) => y !== day) : [...x.days, day].sort((a, b) => a - b)), x))}
                />
                {DAY_NAMES[day]}
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Periods and breaks</h3>
            <p className="text-xs text-muted-foreground">The same every school day. Lessons can&apos;t go in breaks.</p>
          </div>
          <span className="text-xs text-muted-foreground">{d.periods.filter((p) => p.kind === "LESSON").length} lesson periods a day</span>
        </div>
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_6.5rem_6.5rem_8rem_2.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
            <span>Name</span>
            <span>Starts</span>
            <span>Ends</span>
            <span>Type</span>
            <span />
          </div>
          {d.periods.map((p, i) => (
            <div
              key={p.id || `new-${i}`}
              className={`grid grid-cols-2 gap-2 rounded-lg p-1 sm:grid-cols-[1fr_6.5rem_6.5rem_8rem_2.5rem] ${p.kind === "BREAK" ? "bg-muted/60" : ""}`}
            >
              <Input aria-label="Name" className="col-span-2 sm:col-span-1" value={p.label} maxLength={30} onChange={(e) => setRow(i, "label", e.target.value)} />
              <Input aria-label="Starts" type="time" value={p.startsAt} onChange={(e) => setRow(i, "startsAt", e.target.value)} onBlur={sortByTime} />
              <Input aria-label="Ends" type="time" value={p.endsAt} onChange={(e) => setRow(i, "endsAt", e.target.value)} />
              <select aria-label="Type" className="h-10 rounded-md border bg-background px-2 text-sm" value={p.kind} onChange={(e) => setRow(i, "kind", e.target.value)}>
                <option value="LESSON">Lesson</option>
                <option value="BREAK">Break</option>
              </select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${p.label}`} onClick={() => edit((x) => (x.periods.splice(i, 1), x))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => addRow("LESSON")}>
            <Plus className="h-4 w-4" /> Lesson period
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addRow("BREAK")}>
            <Plus className="h-4 w-4" /> Break
          </Button>
        </div>
      </section>

      {confirm && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
          <p className="font-medium text-destructive">{confirm.message}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="destructive" disabled={save.isPending} onClick={() => save.mutate(true)}>
              Save and remove {confirm.lessons} lesson{confirm.lessons === 1 ? "" : "s"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
              Keep editing
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => (setDraft(null), setConfirm(null))}>
          Undo changes
        </Button>
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(false)}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save school day
        </Button>
      </div>
    </div>
  );
}
