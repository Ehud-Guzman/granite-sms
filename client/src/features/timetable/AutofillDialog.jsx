// Auto-fill: preview first (nothing is saved), see what goes where and what
// can't be placed and why, then apply. It only fills empty periods, never
// moves a lesson that's already there, and never double-books a teacher.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { applyAutofill, DAY_SHORT, previewAutofill } from "./timetable.api";

export default function AutofillDialog({ classId, classLabel, year, onPreview, onClose, onApplied }) {
  const [scope, setScope] = useState("class"); // class | school
  const params = scope === "class" ? { classId } : { year };
  const q = useQuery({
    queryKey: ["timetable", "autofill", scope, classId, year],
    queryFn: () => previewAutofill(params),
    staleTime: 0,
  });
  // Hand the plan to the timetable behind, which outlines the new lessons.
  // (q.data keeps its identity between renders, so this runs once per plan.)
  useEffect(() => {
    onPreview(q.data || null);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = useMutation({
    mutationFn: () => applyAutofill(scope === "class" ? { classIds: [classId] } : { year }),
    onSuccess: (r) => {
      toast.success(`${r.placed} lesson${r.placed === 1 ? "" : "s"} added`);
      onApplied();
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't apply. Preview again.")),
  });
  const r = q.data;
  const noTargets = r?.classes.reduce((n, c) => n + (c.withoutTargets || 0), 0) || 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle>Auto-fill the timetable</DialogTitle>
        <DialogDescription>
          Fills empty periods up to each subject&apos;s lessons a week, spread across the week, never more than twice a day, and never with a teacher who is
          busy elsewhere. Lessons already placed stay where they are.
        </DialogDescription>

        <div className="flex gap-1.5">
          <Button size="sm" variant={scope === "class" ? "default" : "outline"} onClick={() => setScope("class")}>
            {classLabel} only
          </Button>
          <Button size="sm" variant={scope === "school" ? "default" : "outline"} onClick={() => setScope("school")}>
            Every class ({year})
          </Button>
        </div>

        {q.isLoading && (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Working it out…
          </p>
        )}
        {q.isError && <p className="text-sm text-destructive">{getErrorMessage(q.error, "Couldn't plan the timetable.")}</p>}

        {r && (
          <div className="space-y-3 text-sm">
            <p>
              <b>{r.placed}</b> lesson{r.placed === 1 ? "" : "s"} can be added
              {r.unplaced ? (
                <>
                  , <b className="text-amber-700 dark:text-amber-400">{r.unplaced}</b> can&apos;t be placed
                </>
              ) : (
                ""
              )}
              .{scope === "class" && r.placed > 0 ? " They're outlined in the timetable behind this box." : ""}
            </p>
            {noTargets > 0 && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {noTargets} subject{noTargets === 1 ? " has" : "s have"} no lessons-a-week target, so auto-fill skips {noTargets === 1 ? "it" : "them"}. Set targets beside the timetable.
              </p>
            )}
            <ul className="divide-y rounded-lg border">
              {r.classes.map((c) => (
                <li key={c.class.id} className="px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{c.class.label}</span>
                    <span className="text-xs text-muted-foreground">+{c.placed.length}</span>
                  </div>
                  {c.unplaced.map((u, i) => (
                    <div key={i} className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                      {u.subject}: {u.missing} not placed. {u.reason}
                    </div>
                  ))}
                  {scope === "class" && c.placed.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {c.placed.map((p) => `${p.subject} ${DAY_SHORT[p.day]}`).join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!r?.placed || apply.isPending}>
            {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add {r?.placed || 0} lesson{r?.placed === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
