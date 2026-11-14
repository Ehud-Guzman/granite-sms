// Place, change or clear one lesson. The choices are the class's subjects with
// the teacher assigned to each (and how many of its lessons are placed), so a
// lesson always has the right teacher. A clash comes back as a plain message.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/errors";
import { DAY_NAMES, setSlot } from "./timetable.api";

export default function SlotDialog({ classId, classLabel, slot, load, onClose, onSaved }) {
  const { day, period, lesson } = slot;
  const current = lesson ? load.find((a) => a.subjectId === lesson.subjectId && a.teacherId === lesson.teacherId) : null;
  const [choice, setChoice] = useState(current?.assignmentId || "");
  const [room, setRoom] = useState(lesson?.room || "");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (body) => setSlot(classId, { day, periodId: period.id, ...body }),
    onSuccess: onSaved,
    onError: (e) => setError(getErrorMessage(e, "Couldn't save that lesson.")),
  });
  const picked = load.find((a) => a.assignmentId === choice);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {classLabel}: {DAY_NAMES[day]}, {period.label}
        </DialogTitle>
        <DialogDescription>
          {period.startsAt}-{period.endsAt}
          {lesson ? ` · now ${lesson.subject?.name}${lesson.teacher ? ` with ${lesson.teacher.name}` : ""}` : " · free"}
        </DialogDescription>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (!picked) return setError("Choose a subject.");
            save.mutate({ subjectId: picked.subjectId, teacherId: picked.teacherId, room });
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Subject and teacher</legend>
            {load.length === 0 && <p className="text-sm text-muted-foreground">No subjects are assigned to this class yet (Settings &gt; Curriculum).</p>}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {load.map((a) => {
                const full = a.lessonsPerWeek != null && a.placed >= a.lessonsPerWeek && a.assignmentId !== current?.assignmentId;
                return (
                  <label
                    key={a.assignmentId}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-muted/50 ${choice === a.assignmentId ? "border-primary ring-1 ring-primary" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input type="radio" name="assignment" value={a.assignmentId} checked={choice === a.assignmentId} onChange={() => setChoice(a.assignmentId)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.subject}</span>
                        <span className="block truncate text-xs text-muted-foreground">{a.teacher}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${full ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {a.placed}
                      {a.lessonsPerWeek != null ? ` of ${a.lessonsPerWeek}` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Room (optional)</span>
            <Input value={room} maxLength={40} placeholder="e.g. Lab 1" onChange={(e) => setRoom(e.target.value)} />
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-between gap-2 pt-1">
            {lesson ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={save.isPending} onClick={() => save.mutate({ subjectId: null })}>
                Clear this period
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending || !choice}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
