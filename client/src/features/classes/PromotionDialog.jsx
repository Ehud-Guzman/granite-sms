// End-of-year promotion: choose where each class goes (a class next year, or
// "graduates"), preview the numbers, then apply in one step on the server.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listClasses } from "@/api/classes.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const label = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})`;
const KEEP = "__keep__";
const GRADUATE = "__graduate__";

/** Suggests the same stream one grade up in the next year, e.g. Grade 7 E -> Grade 8 E. */
function suggest(from, nextYearClasses) {
  const m = /^(.*?)(\d+)\s*$/.exec(from.name.trim());
  if (!m) return KEEP;
  const wanted = `${m[1]}${Number(m[2]) + 1}`.trim().toLowerCase();
  const hit = nextYearClasses.find(
    (c) => c.name.trim().toLowerCase() === wanted && (c.stream || "") === (from.stream || "")
  );
  return hit ? hit.id : KEEP;
}

export default function PromotionDialog({ open, onOpenChange, fromYear }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(null);
  const sourceYear = year ?? fromYear;
  const [choice, setChoice] = useState({});
  const [exitDate, setExitDate] = useState("");
  const [preview, setPreview] = useState(null);

  const fromQ = useQuery({ queryKey: ["classes", { year: sourceYear }], queryFn: () => listClasses({ year: sourceYear }), enabled: open });
  const toQ = useQuery({
    queryKey: ["classes", { year: Number(sourceYear) + 1 }],
    queryFn: () => listClasses({ year: Number(sourceYear) + 1 }),
    enabled: open,
  });
  const fromClasses = useMemo(() => (fromQ.data || []).filter((c) => c.isActive !== false), [fromQ.data]);
  const toClasses = useMemo(() => (toQ.data || []).filter((c) => c.isActive !== false), [toQ.data]);

  const pick = (c) => choice[c.id] ?? suggest(c, toClasses);
  const moves = fromClasses
    .map((c) => ({ c, to: pick(c) }))
    .filter((x) => x.to !== KEEP)
    .map((x) => ({ fromClassId: x.c.id, toClassId: x.to === GRADUATE ? null : x.to }));

  const run = useMutation({
    mutationFn: (dryRun) =>
      api.post("/api/classes/promote", { moves, dryRun, ...(exitDate ? { exitDate } : {}) }).then((r) => r.data),
    onSuccess: async (data) => {
      if (data.dryRun) return setPreview(data);
      toast.success(`Done: ${data.totals.moved} moved up, ${data.totals.graduated} graduated`);
      setPreview(null);
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ["classes"] });
      await qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Promotion failed"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setPreview(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>End-of-year promotion</DialogTitle>
          <DialogDescription>
            Choose where each class goes. Every active learner in it moves together. Create next year&apos;s classes first.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="promo-year">From year</Label>
            <Input
              id="promo-year"
              type="number"
              className="w-28"
              value={sourceYear}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setChoice({});
                setPreview(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="promo-exit">Graduation date</Label>
            <Input id="promo-exit" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          </div>
        </div>

        {fromQ.isLoading || toQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading classes…</div>
        ) : fromClasses.length === 0 ? (
          <div className="text-sm text-muted-foreground">No classes in {sourceYear}.</div>
        ) : (
          <div className="space-y-2">
            {toClasses.length === 0 && (
              <div className="text-sm text-amber-700">
                There are no {Number(sourceYear) + 1} classes yet. Create them, or only graduate classes now.
              </div>
            )}
            {fromClasses.map((c) => (
              <div key={c.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:items-center">
                <div className="text-sm font-medium">{label(c)}</div>
                <select
                  aria-label={`Destination for ${label(c)}`}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={pick(c)}
                  onChange={(e) => {
                    setChoice((p) => ({ ...p, [c.id]: e.target.value }));
                    setPreview(null);
                  }}
                >
                  <option value={KEEP}>Don&apos;t move</option>
                  {toClasses.map((t) => (
                    <option key={t.id} value={t.id}>
                      → {label(t)}
                    </option>
                  ))}
                  <option value={GRADUATE}>Graduates (leave the school)</option>
                </select>
              </div>
            ))}
          </div>
        )}

        {preview && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="font-medium">
              {preview.totals.moved} learner(s) move up, {preview.totals.graduated} graduate.
            </div>
            {preview.summary.map((x) => (
              <div key={x.fromClassId} className="text-muted-foreground">
                {x.from} → {x.to}: {x.learners}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!preview ? (
            <Button disabled={!moves.length || run.isPending} onClick={() => run.mutate(true)}>
              Preview
            </Button>
          ) : (
            <Button disabled={run.isPending} onClick={() => run.mutate(false)}>
              {run.isPending ? "Applying…" : "Apply promotion"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
