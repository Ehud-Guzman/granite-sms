// A class's week. Admins edit it: click a slot to place or change a lesson,
// set how many lessons a week each subject needs, and auto-fill the rest.
// Teachers see the same week read-only.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Sparkles } from "lucide-react";

import { listClasses } from "@/api/classes.api";
import { downloadFromApi } from "@/lib/download";
import { getErrorMessage } from "@/lib/errors";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Meter } from "@/components/insights/Insights";
import { RowsSkeleton } from "@/components/ui/state-blocks";

import WeekGrid from "./WeekGrid";
import SlotDialog from "./SlotDialog";
import AutofillDialog from "./AutofillDialog";
import { getClassTimetable, setTargets } from "./timetable.api";

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

  const [editing, setEditing] = useState(null); // { day, period, lesson }
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [previewData, setPreview] = useState(null); // the auto-fill plan being previewed
  const preview = useMemo(() => {
    const mine = previewData?.classes?.find((c) => c.class.id === classId);
    return mine ? new Set(mine.placed.map((p) => `${p.day}|${p.periodId}`)) : null;
  }, [previewData, classId]);

  const lessonSlots = t ? t.days.length * t.periods.filter((p) => p.kind === "LESSON").length : 0;

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
            {t.lessons.length} of {lessonSlots} lesson periods filled
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setAutofillOpen(true)} disabled={!t}>
              <Sparkles className="h-4 w-4" /> Auto-fill
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!t}
            onClick={() =>
              downloadFromApi(`/api/timetable/classes/${classId}/pdf`, "timetable.pdf").catch(() => toast.error("Couldn't prepare the PDF. Try again."))
            }
          >
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
        // The week gets the full width; the targets sit beside it only on very wide screens.
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <WeekGrid
              days={t.days}
              periods={t.periods}
              lessons={t.lessons}
              subjects={t.subjects}
              lines={(l) => [l.subject?.name, [l.teacher?.name, l.room].filter(Boolean).join(" · ")]}
              onSlot={canEdit ? (day, period, lesson) => setEditing({ day, period, lesson }) : undefined}
              highlight={preview}
              today={today}
            />
            {canEdit && <p className="text-xs text-muted-foreground">Click a period to add, change or clear a lesson.</p>}
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
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setPreview(null);
            qc.invalidateQueries({ queryKey: ["timetable"] });
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
            qc.invalidateQueries({ queryKey: ["timetable"] });
          }}
        />
      )}
    </div>
  );
}

/** Lessons a week per subject: placed against target, with the targets editable. */
function LoadPanel({ t, canEdit, classId, onSaved }) {
  const [draft, setDraft] = useState({});
  const dirty = Object.keys(draft).length > 0;
  const save = useMutation({
    mutationFn: () =>
      setTargets(
        classId,
        Object.entries(draft).map(([assignmentId, v]) => ({ assignmentId, lessonsPerWeek: v === "" ? null : Number(v) }))
      ),
    onSuccess: (next) => {
      setDraft({});
      onSaved(next);
      toast.success("Lessons a week saved");
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
        <ul className="space-y-2">
          {t.load.map((a) => {
            const target = a.assignmentId in draft ? draft[a.assignmentId] : a.lessonsPerWeek ?? "";
            const pct = a.lessonsPerWeek ? Math.min(100, (a.placed / a.lessonsPerWeek) * 100) : 0;
            const tone = !a.lessonsPerWeek ? "muted" : a.placed === a.lessonsPerWeek ? "good" : a.placed > a.lessonsPerWeek ? "alert" : "warn";
            return (
              <li key={a.assignmentId} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.teacher}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                    <span>{a.placed} /</span>
                    {canEdit ? (
                      <Input
                        aria-label={`Lessons a week for ${a.subject}`}
                        type="number"
                        min={0}
                        max={20}
                        className="h-7 w-14 px-2 text-xs"
                        value={target}
                        onChange={(e) => setDraft((d) => ({ ...d, [a.assignmentId]: e.target.value }))}
                      />
                    ) : (
                      <span>{a.lessonsPerWeek ?? "—"}</span>
                    )}
                  </div>
                </div>
                {a.lessonsPerWeek ? <Meter percent={pct} tone={tone} className="mt-1 h-1" /> : null}
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
    </section>
  );
}
