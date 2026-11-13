// Opening and closing dates of each term for one year. The server uses them
// to work out the current term and to keep registers inside term time.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getTermDates, putTermDates } from "@/api/settingsGeneral.api";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RowsSkeleton } from "@/components/ui/state-blocks";

const TERMS = ["TERM1", "TERM2", "TERM3"];

function rowsFor(termDates, year) {
  return TERMS.map((term) => {
    const t = termDates.find((d) => d.year === year && d.term === term);
    return { term, startsOn: t?.startsOn || "", endsOn: t?.endsOn || "" };
  });
}

export default function TermDatesCard({ scopeParams, labels }) {
  const qc = useQueryClient();
  const { currentYear } = useSchoolCalendar();
  const [year, setYear] = useState(null);
  const shownYear = year ?? currentYear;

  const q = useQuery({
    queryKey: ["settings", "termDates", scopeParams?.schoolId || "tenant"],
    queryFn: () => getTermDates(scopeParams),
  });

  // Edits are kept per year; untouched years show what is saved.
  const [edits, setEdits] = useState({});
  const saved = useMemo(() => rowsFor(q.data || [], shownYear), [q.data, shownYear]);
  const rows = edits[shownYear] || saved;
  const dirty = !!edits[shownYear];

  const setRow = (term, field, value) =>
    setEdits((prev) => ({
      ...prev,
      [shownYear]: (prev[shownYear] || saved).map((r) => (r.term === term ? { ...r, [field]: value } : r)),
    }));

  const save = useMutation({
    mutationFn: () => putTermDates(shownYear, rows.filter((r) => r.startsOn && r.endsOn), scopeParams),
    onSuccess: async () => {
      setEdits((prev) => ({ ...prev, [shownYear]: undefined }));
      await qc.invalidateQueries({ queryKey: ["settings", "termDates"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(`Term dates for ${shownYear} saved`);
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to save term dates"),
  });

  const half = rows.some((r) => !!r.startsOn !== !!r.endsOn);
  const label = (term) => labels?.[`term${term.slice(-1)}Label`] || `Term ${term.slice(-1)}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Term dates</CardTitle>
            <CardDescription>
              Opening and closing day of each term. Registers can only be taken inside term.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="term-dates-year" className="text-sm">
              Year
            </Label>
            <Input
              id="term-dates-year"
              type="number"
              className="w-24"
              value={shownYear}
              onChange={(e) => setYear(Number(e.target.value) || currentYear)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <RowsSkeleton />
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.term} className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:items-end">
                <div className="text-sm font-medium sm:pb-2">{label(r.term)}</div>
                <div className="space-y-1">
                  <Label htmlFor={`${r.term}-opens`} className="text-xs text-muted-foreground">
                    Opens
                  </Label>
                  <Input
                    id={`${r.term}-opens`}
                    type="date"
                    value={r.startsOn}
                    onChange={(e) => setRow(r.term, "startsOn", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${r.term}-closes`} className="text-xs text-muted-foreground">
                    Closes
                  </Label>
                  <Input
                    id={`${r.term}-closes`}
                    type="date"
                    value={r.endsOn}
                    onChange={(e) => setRow(r.term, "endsOn", e.target.value)}
                  />
                </div>
              </div>
            ))}
            {half && <div className="text-xs text-destructive">Give each term both an opening and a closing date.</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => setEdits((prev) => ({ ...prev, [shownYear]: undefined }))}
              >
                Reset
              </Button>
              <Button disabled={!dirty || half || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save term dates"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
