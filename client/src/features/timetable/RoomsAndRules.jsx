// Rooms (the lab, the hall) and a teacher's rules (most lessons a day, times
// they can't teach). Both feed the clash checks and auto-fill.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowsSkeleton } from "@/components/ui/state-blocks";
import { getErrorMessage } from "@/lib/errors";
import { DAY_NAMES, deleteRoom, getSetup, getTeacherRules, saveRoom, saveTeacherRules } from "./timetable.api";

export function RoomsView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timetable", "setup"], queryFn: getSetup });
  const [name, setName] = useState("");
  const done = (msg) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["timetable"] });
  };
  const err = (e) => toast.error(getErrorMessage(e, "Couldn't save"));
  const add = useMutation({
    mutationFn: () => saveRoom(null, { name }),
    onSuccess: () => {
      setName("");
      done("Room added")();
    },
    onError: err,
  });
  const update = useMutation({ mutationFn: ({ id, body }) => saveRoom(id, body), onSuccess: done("Room saved"), onError: err });
  const remove = useMutation({ mutationFn: (id) => deleteRoom(id), onSuccess: done("Room removed; its lessons keep their times"), onError: err });
  if (q.isLoading) return <RowsSkeleton rows={4} />;
  const rooms = q.data?.rooms || [];
  return (
    <section className="max-w-2xl space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Rooms</h3>
        <p className="text-xs text-muted-foreground">
          Shared rooms like the lab or the computer room. A room holds one class at a time; set a subject&apos;s room beside each class&apos;s timetable and
          auto-fill books it.
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input placeholder="e.g. Science lab" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rooms yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Input
                aria-label="Room name"
                defaultValue={r.name}
                maxLength={40}
                className="h-8"
                onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && update.mutate({ id: r.id, body: { name: e.target.value } })}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={r.isActive} onChange={(e) => update.mutate({ id: r.id, body: { name: r.name, isActive: e.target.checked } })} />
                In use
              </label>
              <Button size="icon" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => remove.mutate(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TeacherRules({ teacherId, days }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timetable", "rules", teacherId], queryFn: () => getTeacherRules(teacherId), enabled: !!teacherId });
  const [draft, setDraft] = useState(null);
  const d = draft || (q.data ? { maxLessonsPerDay: q.data.maxLessonsPerDay ?? "", blocks: q.data.blocks.map((b) => ({ ...b })) } : null);
  const save = useMutation({
    mutationFn: () => saveTeacherRules(teacherId, { maxLessonsPerDay: d.maxLessonsPerDay === "" ? null : Number(d.maxLessonsPerDay), blocks: d.blocks }),
    onSuccess: () => {
      setDraft(null);
      toast.success("Teacher's rules saved");
      qc.invalidateQueries({ queryKey: ["timetable"] });
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save")),
  });
  if (!d) return null;
  const edit = (fn) => setDraft(fn(structuredClone(d)));
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Rules for {q.data.teacher.name}</h3>
      <label className="flex items-center gap-2 text-sm">
        Most lessons in a day
        <Input type="number" min={1} max={16} className="h-8 w-24" placeholder="No limit" value={d.maxLessonsPerDay} onChange={(e) => edit((x) => ((x.maxLessonsPerDay = e.target.value), x))} />
      </label>
      <div className="space-y-2">
        <div className="text-sm">Times they can&apos;t teach</div>
        {d.blocks.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Day" className="h-8 rounded-md border bg-background px-2 text-sm" value={b.day} onChange={(e) => edit((x) => ((x.blocks[i].day = Number(e.target.value)), x))}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {DAY_NAMES[day]}
                </option>
              ))}
            </select>
            <Input aria-label="From" type="time" className="h-8 w-28" value={b.startsAt} onChange={(e) => edit((x) => ((x.blocks[i].startsAt = e.target.value), x))} />
            <Input aria-label="To" type="time" className="h-8 w-28" value={b.endsAt} onChange={(e) => edit((x) => ((x.blocks[i].endsAt = e.target.value), x))} />
            <Input aria-label="Reason" className="h-8 w-40" placeholder="e.g. Part-time" maxLength={80} value={b.note || ""} onChange={(e) => edit((x) => ((x.blocks[i].note = e.target.value), x))} />
            <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => edit((x) => (x.blocks.splice(i, 1), x))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => edit((x) => (x.blocks.push({ day: days[0], startsAt: "14:00", endsAt: "16:30", note: "" }), x))}>
          <Plus className="h-4 w-4" /> Add a time
        </Button>
      </div>
      {draft && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Undo
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
          </Button>
        </div>
      )}
    </section>
  );
}
