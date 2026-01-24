import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { listFeeItems, listFeePlans, createFeePlan } from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import QueryBlock from "../components/QueryBlock";
import { money, toNumberOrZero } from "../components/FeeMoney";

export default function FeePlansTab() {
  const qc = useQueryClient();

  const [classId, setClassId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState("TERM1");
  const [title, setTitle] = useState("");

  const classesQ = useQuery({ queryKey: ["classes"], queryFn: () => listClasses({}) });
  const itemsQ = useQuery({ queryKey: ["feeItems"], queryFn: listFeeItems });

  const plansQ = useQuery({
    queryKey: ["feePlans", { classId, year, term }],
    queryFn: () => listFeePlans({ classId: classId || undefined, year, term }),
  });

  const feeItems = Array.isArray(itemsQ.data) ? itemsQ.data.filter((x) => x.isActive) : [];
  const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
  const plans = Array.isArray(plansQ.data) ? plansQ.data : [];

  const [planLines, setPlanLines] = useState([{ feeItemId: "", amount: 0, required: true }]);

  const selectedIds = useMemo(
    () => planLines.map((l) => l.feeItemId).filter(Boolean),
    [planLines]
  );

  const total = useMemo(
    () => planLines.reduce((sum, l) => sum + toNumberOrZero(l.amount), 0),
    [planLines]
  );

  const createPlanMut = useMutation({
    mutationFn: createFeePlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feePlans"] });
      setPlanLines([{ feeItemId: "", amount: 0, required: true }]);
      setTitle("");
    },
  });

  const canCreate =
    classId &&
    year &&
    term &&
    planLines.every((l) => l.feeItemId && toNumberOrZero(l.amount) > 0) &&
    new Set(selectedIds).size === selectedIds.length; // no duplicates

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">Select class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.stream ? ` ${c.stream}` : ""} ({c.year})
                </option>
              ))}
            </select>

            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="TERM1">TERM1</option>
              <option value="TERM2">TERM2</option>
              <option value="TERM3">TERM3</option>
            </select>

            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          </div>

          <Separator />

          <div className="space-y-2">
            {planLines.map((l, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-12 items-center">
                <div className="md:col-span-6">
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={l.feeItemId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPlanLines((prev) => prev.map((x, i) => (i === idx ? { ...x, feeItemId: v } : x)));
                    }}
                  >
                    <option value="">Select fee item…</option>
                    {feeItems.map((it) => (
                      <option key={it.id} value={it.id} disabled={selectedIds.includes(it.id) && it.id !== l.feeItemId}>
                        {it.name} {it.code ? `(${it.code})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={l.amount}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPlanLines((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: v } : x)));
                    }}
                  />
                </div>

                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!l.required}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setPlanLines((prev) => prev.map((x, i) => (i === idx ? { ...x, required: v } : x)));
                    }}
                  />
                  <span className="text-sm">Required</span>
                </div>

                <div className="md:col-span-1 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPlanLines((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={planLines.length === 1}
                  >
                    X
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPlanLines((p) => [...p, { feeItemId: "", amount: 0, required: true }])}
              >
                + Add line
              </Button>

              <div className="text-sm">
                Total: <span className="font-semibold">{money(total)}</span>
              </div>
            </div>

            {new Set(selectedIds).size !== selectedIds.length && (
              <div className="text-sm text-destructive">Duplicate fee items detected — remove duplicates.</div>
            )}
          </div>

          <Button
            onClick={() =>
              createPlanMut.mutate({
                classId,
                year,
                term,
                title: title || null,
                items: planLines.map((x) => ({
                  feeItemId: x.feeItemId,
                  amount: Number(x.amount),
                  required: !!x.required,
                })),
              })
            }
            disabled={!canCreate || createPlanMut.isPending}
          >
            {createPlanMut.isPending ? "Creating…" : "Create plan"}
          </Button>

          {createPlanMut.isError && (
            <div className="text-sm text-destructive">
              {createPlanMut.error?.response?.data?.message || "Failed to create plan."}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <QueryBlock
            isLoading={plansQ.isLoading}
            isError={plansQ.isError}
            error={plansQ.error}
            empty={!plansQ.isLoading && !plansQ.isError && plans.length === 0}
            emptyText="No plans found for the selected filters."
          >
            <div className="grid gap-2">
              {plans.map((p) => {
                const sum = (p.items || []).reduce((s, it) => s + (it.amount || 0), 0);
                return (
                  <div key={p.id} className="border rounded-md p-3 bg-background">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">
                        {p.title || "Fee Plan"} • {p.term} {p.year}
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {p.items?.length || 0} items
                      </Badge>
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground">
                      Total: <span className="font-medium text-foreground">{money(sum)}</span>
                    </div>

                    {!!p.items?.length && (
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {p.items.slice(0, 5).map((it) => (
                          <div key={it.id} className="flex justify-between">
                            <span>{it.feeItem?.name || it.feeItemId}</span>
                            <span className="font-medium text-foreground">{money(it.amount)}</span>
                          </div>
                        ))}
                        {p.items.length > 5 && <div>…and {p.items.length - 5} more</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </QueryBlock>
        </CardContent>
      </Card>
    </div>
  );
}
