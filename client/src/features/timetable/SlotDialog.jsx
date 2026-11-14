// One slot of a class's week: what's there now (each lesson can be cleared),
// and a form to place a lesson. The subject comes with its assigned teacher;
// the room defaults to the subject's room. A group name splits the class
// (options taught side by side, e.g. CRE and IRE); ticking other classes makes
// it one combined lesson with the same teacher. Clashes come back in plain words.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link2, Loader2, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/errors";
import { DAY_NAMES, setSlot } from "./timetable.api";

export default function SlotDialog({ classId, classLabel, slot, load, rooms = [], otherClasses = [], onClose, onSaved }) {
  const { day, period, lessons = [] } = slot;
  const whole = lessons.find((l) => !l.group);
  const current = whole ? load.find((a) => a.subjectId === whole.subjectId && a.teacherId === whole.teacherId) : null;
  const [choice, setChoice] = useState(current?.assignmentId || "");
  const [roomId, setRoomId] = useState(whole ? whole.roomId || "" : "default");
  const [split, setSplit] = useState(lessons.some((l) => l.group));
  const [group, setGroup] = useState("");
  const [also, setAlso] = useState([]);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (body) => setSlot(classId, { day, periodId: period.id, ...body }),
    onSuccess: onSaved,
    onError: (e) => setError(getErrorMessage(e, "Couldn't save that lesson.")),
  });
  const picked = load.find((a) => a.assignmentId === choice);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!picked) return setError("Choose a subject.");
    if (split && !group.trim()) return setError("Name the group (e.g. the subject, CRE).");
    save.mutate({
      subjectId: picked.subjectId,
      teacherId: picked.teacherId,
      ...(roomId === "default" ? {} : { roomId: roomId || null }),
      group: split ? group.trim() : "",
      alsoClassIds: also,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogTitle>
          {classLabel}: {DAY_NAMES[day]}, {period.label}
        </DialogTitle>
        <DialogDescription>
          {period.startsAt}-{period.endsAt}
        </DialogDescription>

        {lessons.length > 0 && (
          <ul className="space-y-1.5">
            {lessons.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {l.subject?.name}
                    {l.group ? ` (${l.group})` : ""}
                    {l.linkId && <Link2 className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label="combined" />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{[l.teacher?.name, l.room].filter(Boolean).join(" · ")}</span>
                </span>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={save.isPending} onClick={() => save.mutate({ subjectId: null, group: l.group })}>
                  <X className="h-4 w-4" /> Clear
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form className="space-y-3 border-t pt-3" onSubmit={submit}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lessons.length ? "Place or replace" : "Place a lesson"}</div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {load.length === 0 && <p className="text-sm text-muted-foreground">No subjects are assigned to this class yet (Settings &gt; Curriculum).</p>}
            {load.map((a) => (
              <label key={a.assignmentId} className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50 ${choice === a.assignmentId ? "border-primary ring-1 ring-primary" : ""}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <input type="radio" name="assignment" checked={choice === a.assignmentId} onChange={() => setChoice(a.assignmentId)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[a.teacher, a.room].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {a.placed}
                  {a.lessonsPerWeek != null ? ` of ${a.lessonsPerWeek}` : ""}
                </span>
              </label>
            ))}
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Room</span>
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="default">The subject&apos;s room{picked?.room ? ` (${picked.room})` : " (none set)"}</option>
              <option value="">No room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            <span>
              Split the class: this is one group&apos;s lesson
              <span className="block text-xs text-muted-foreground">For options taught side by side, e.g. CRE and IRE at the same time.</span>
            </span>
          </label>
          {split && <Input aria-label="Group name" placeholder="Group name, e.g. CRE" maxLength={30} value={group} onChange={(e) => setGroup(e.target.value)} />}

          {otherClasses.length > 0 && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none">Combine with other classes {also.length ? `(${also.length})` : ""}</summary>
              <p className="mt-1 text-xs text-muted-foreground">The same teacher teaches them together. They need a period at the same time.</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {otherClasses.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={also.includes(c.id)} onChange={(e) => setAlso((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </details>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !choice}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
