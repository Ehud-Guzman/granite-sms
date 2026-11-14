// A class's week. Admins edit it: click a slot to place, split, combine or
// clear lessons, drag a lesson to move or swap it, set each subject's lessons
// a week, doubles, room and option block, auto-fill the rest, or start from
// last year's timetable. Teachers see the same week read-only.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Download, Loader2, Sparkles } from "lucide-react";

import { listClasses } from "@/api/classes.api";
import { downloadFromApi } from "@/lib/download";
import { getErrorMessage } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm-store";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Meter } from "@/components/insights/Insights";
import { RowsSkeleton } from "@/components/ui/state-blocks";

import WeekGrid from "./WeekGrid";
import SlotDialog from "./SlotDialog";
import AutofillDialog from "./AutofillDialog";
import { copyForward, getClassTimetable, moveLesson, setTargets } from "./timetable.api";

const classLabel = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""}`;

export default function ClassTimetable({ canEdit, today }) {
  const qc = useQueryClient();
  const { currentYear } = useSchoolCalendar();
  const classesQ = useQuery({ queryKey: ["classes", { timetable: true }], queryFn: () => listClasses({}), staleTime: 60_000 });
  const classes = useMemo(
    () =>
      (Array.isArray(classesQ.data) ? classesQ.data : [])
        .filter((c) => c.isActive !== false && (!currentYear || Number(c.year) === Number(currentYear)))
        .sort((a, b) => classLabel(a).localeCompare(classLabel(b), undefined, { numeric: true })),
    [classesQ.data, currentYear]
  );
  const [picked, setPicked] = useState("");
  const classId = picked || classes[0]?.id || "";
  const ttQ = useQuery({ queryKey: ["timetable", "class", classId], queryFn: () => getClassTimetable(classId), enabled: !!classId });
  const t = ttQ.data;

  const [editing, setEditing] = useState(null);
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [previewData, setPreview] = useState(null);
  const preview = useMemo(() => {
    const mine = previewData?.classes?.find((c) => c.class.id === classId);
    return mine ? new Set(mine.placed.map((p) => `${p.day}|${p.periodId}`)) : null;
  }, [previewData, classId]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["timetable"] });

  const move = useMutation({
    mutationFn: ({ lesson, day, period }) => moveLesson(classId, { day: lesson.day, periodId: lesson.periodId, group: lesson.group }, { day, periodId: period.id }),
    onSuccess: (r) => {
      if (r.moved) toast.success(r.swapped ? "Lessons swapped" : "Lesson moved");
      refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't move that lesson.")),
  });
  const copy = useMutation({
    mutationFn: () => copyForward(Number(currentYear) - 1, Number(currentYear)),
    onSuccess: (r) => {
      toast.success(`${r.copied} lesson${r.copied === 1 ? "" : "s"} copied${r.skipped ? `, ${r.skipped} skipped` : ""}`);
      if (r.skipped) toast.message(r.details.slice(0, 3).join("\n"));
      refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't copy.")),
  });

  const lessonSlots = t ? t.days.reduce((n, d) => n + t.periods.filter((p) => p.kind === "LESSON" && (!p.days?.length || p.days.includes(d))).length, 0) : 0;
  const filled = t ? new Set(t.lessons.map((l) => `${l.day}|${l.periodId}`)).size : 0;
  const otherClasses = classes.filter((c) => c.id !== classId).map((c) => ({ id: c.id, label: classLabel(c) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Class"
          className="h-10 min-w-[12rem] rounded-md border bg-background px-3 text-sm"
          value={classId}
          onChange={(e) => {
            setPicked(e.target.value);
            setPreview(null);
          }}
          disabled={classesQ.isLoading}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </select>
        {t && (
          <span className="text-sm text-muted-foreground">
            {t.schedule?.name} · {filled} of {lessonSlots} lesson periods filled
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <>
              <Button
                variant="ghost"
                disabled={copy.isPending}
                onClick={async () => {
                  if (await confirmAction({ title: `Copy ${Number(currentYear) - 1}'s timetable into ${currentYear}?`, description: "Each class takes last year's lessons for the class with the same name, where the subject is still taught there and nothing clashes. Lessons already placed stay.", confirmLabel: "Copy" }))
                    copy.mutate();
                }}
              >
                <Copy className="h-4 w-4" /> From last year
              </Button>
              <Button variant="outline" onClick={() => setAutofillOpen(true)} disabled={!t}>
                <Sparkles className="h-4 w-4" /> Auto-fill
              </Button>
            </>
          )}
          <Button variant="outline" disabled={!t} onClick={() => downloadFromApi(`/api/timetable/classes/${classId}/pdf`, "timetable.pdf").catch(() => toast.error("Couldn't prepare the PDF."))}>
            <Download className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {!classesQ.isLoading && !classes.length && (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No active classes for {currentYear}. Add classes first.</p>
      )}
      {ttQ.isLoading && <RowsSkeleton rows={5} />}
      {ttQ.isError && <p className="text-sm text-destructive">{getErrorMessage(ttQ.error, "Couldn't load the timetable.")}</p>}

      {t && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`min-w-0 space-y-2 ${move.isPending ? "opacity-60" : ""}`}>
            <WeekGrid
              days={t.days}
              periods={t.periods}
              lessons={t.lessons}
              subjects={t.subjects}
              lines={(l) => [l.subject?.name, [l.teacher?.name, l.room].filter(Boolean).join(" · ")]}
              onSlot={canEdit ? (day, period, lessons) => setEditing({ day, period, lessons }) : undefined}
              onMove={canEdit ? (lesson, day, period) => move.mutate({ lesson, day, period }) : undefined}
              highlight={preview}
              today={today}
            />
            {canEdit && <p className="text-xs text-muted-foreground">Click a period to add, split, combine or clear a lesson. Drag a lesson onto another period to move it, or onto a lesson to swap them.</p>}
          </div>
          <aside className="grid content-start gap-4 md:grid-cols-2 2xl:grid-cols-1">
            <LoadPanel t={t} canEdit={canEdit} classId={classId} onSaved={(next) => qc.setQueryData(["timetable", "class", classId], next)} />
            {t.warnings?.length > 0 && (
              <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <h3 className="mb-1.5 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Needs attention
                </h3>
                <ul className="list-disc space-y-1 pl-5">
                  {t.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {canEdit && editing && t && (
        <SlotDialog
          classId={classId}
          classLabel={t.class.label}
          slot={editing}
          load={t.load}
          rooms={t.rooms}
          otherClasses={otherClasses}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setPreview(null);
            refresh();
          }}
        />
      )}
      {canEdit && autofillOpen && t && (
        <AutofillDialog
          classId={classId}
          classLabel={t.class.label}
          year={t.class.year}
          onPreview={setPreview}
          onClose={() => {
            setAutofillOpen(false);
            setPreview(null);
          }}
          onApplied={() => {
            setAutofillOpen(false);
            setPreview(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Per subject: lessons a week (placed / target), doubles, room and option block. */
function LoadPanel({ t, canEdit, classId, onSaved }) {
  const [draft, setDraft] = useState({});
  const dirty = Object.keys(draft).length > 0;
  const set = (id, k, v) => setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), [k]: v } }));
  const val = (a, k) => (draft[a.assignmentId] && k in draft[a.assignmentId] ? draft[a.assignmentId][k] : a[k] ?? "");
  const save = useMutation({
    mutationFn: () => setTargets(classId, Object.entries(draft).map(([assignmentId, v]) => ({ assignmentId, ...v }))),
    onSuccess: (next) => {
      setDraft({});
      onSaved(next);
      toast.success("Saved");
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save")),
  });
  const totalTarget = t.load.reduce((n, a) => n + (a.lessonsPerWeek || 0), 0);

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Lessons a week</h3>
        <span className="text-xs text-muted-foreground">
          {t.lessons.length} placed{totalTarget ? ` of ${totalTarget}` : ""}
        </span>
      </div>
      {t.load.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subjects are assigned to this class yet (Settings &gt; Curriculum).</p>
      ) : (
        <ul className="space-y-3">
          {t.load.map((a) => {
            const pct = a.lessonsPerWeek ? Math.min(100, (a.placed / a.lessonsPerWeek) * 100) : 0;
            const tone = !a.lessonsPerWeek ? "muted" : a.placed === a.lessonsPerWeek ? "good" : a.placed > a.lessonsPerWeek ? "alert" : "warn";
            return (
              <li key={a.assignmentId} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.teacher}
                      {!canEdit && a.room ? ` · ${a.room}` : ""}
                      {!canEdit && a.optionBlock ? ` · ${a.optionBlock}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                    <span>{a.placed} /</span>
                    {canEdit ? (
                      <Input aria-label={`Lessons a week for ${a.subject}`} type="number" min={0} max={20} className="h-7 w-14 px-2 text-xs" value={val(a, "lessonsPerWeek")} onChange={(e) => set(a.assignmentId, "lessonsPerWeek", e.target.value)} />
                    ) : (
                      <span>{a.lessonsPerWeek ?? "—"}</span>
                    )}
                  </div>
                </div>
                {a.lessonsPerWeek ? <Meter percent={pct} tone={tone} className="mt-1 h-1" /> : null}
                {canEdit && (
                  <div className="mt-1.5 grid grid-cols-[5.5rem_1fr_1fr] gap-1.5">
                    <Input aria-label={`Doubles for ${a.subject}`} title="Double lessons a week" type="number" min={0} max={10} placeholder="Doubles" className="h-7 px-2 text-xs" value={val(a, "doublesPerWeek")} onChange={(e) => set(a.assignmentId, "doublesPerWeek", e.target.value)} />
                    <select aria-label={`Room for ${a.subject}`} className="h-7 rounded-md border bg-background px-1 text-xs" value={val(a, "roomId")} onChange={(e) => set(a.assignmentId, "roomId", e.target.value)}>
                      <option value="">No set room</option>
                      {t.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <Input aria-label={`Option block for ${a.subject}`} title="Subjects with the same block name are taught at the same time to different groups" placeholder="Option block" maxLength={30} className="h-7 px-2 text-xs" value={val(a, "optionBlock")} onChange={(e) => set(a.assignmentId, "optionBlock", e.target.value)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft({})}>
            Undo
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      )}
      {canEdit && <p className="mt-2 text-[11px] text-muted-foreground">Doubles: how many come as two periods back to back. Option block: subjects with the same name go side by side (e.g. CRE and IRE as &quot;Religion&quot;).</p>}
    </section>
  );
}
