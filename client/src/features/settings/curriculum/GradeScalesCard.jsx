// Grading scales: add from a template (KCSE, CBE Junior School, CBE Primary),
// edit bands, choose the school default and which classes use which scale.
// Published results keep the grades they were published with.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listClasses } from "@/api/classes.api";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const getScales = () => api.get("/api/grade-scales").then((r) => r.data);
const classLabel = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""}`;

function BandsEditor({ scale, onSaved }) {
  const [rows, setRows] = useState(scale.bands);
  const [dirty, setDirty] = useState(false);
  const set = (i, k, v) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () => api.put(`/api/grade-scales/${scale.id}`, { bands: rows }).then((r) => r.data),
    onSuccess: () => {
      setDirty(false);
      toast.success("Scale saved");
      onSaved();
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Could not save"),
  });

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="p-1">Grade</th>
              <th className="p-1">From</th>
              <th className="p-1">To</th>
              <th className="p-1">Points</th>
              <th className="p-1">Remark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={i}>
                <td className="p-1 w-20">
                  <Input aria-label="Grade" value={b.label} onChange={(e) => set(i, "label", e.target.value)} />
                </td>
                <td className="p-1 w-20">
                  <Input aria-label="From mark" type="number" value={b.minScore} onChange={(e) => set(i, "minScore", Number(e.target.value))} />
                </td>
                <td className="p-1 w-20">
                  <Input aria-label="To mark" type="number" value={b.maxScore} onChange={(e) => set(i, "maxScore", Number(e.target.value))} />
                </td>
                <td className="p-1 w-20">
                  <Input aria-label="Points" type="number" value={b.points ?? ""} onChange={(e) => set(i, "points", e.target.value === "" ? null : Number(e.target.value))} />
                </td>
                <td className="p-1">
                  <Input aria-label="Remark" value={b.remark || ""} onChange={(e) => set(i, "remark", e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save bands"}
        </Button>
      </div>
    </div>
  );
}

export default function GradeScalesCard() {
  const qc = useQueryClient();
  const { currentYear } = useSchoolCalendar();
  const q = useQuery({ queryKey: ["gradeScales"], queryFn: getScales });
  const classesQ = useQuery({ queryKey: ["classes", { year: currentYear }], queryFn: () => listClasses({ year: currentYear }) });
  const [open, setOpen] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["gradeScales"] });
  const err = (e) => toast.error(e?.response?.data?.message || "Could not save");

  const create = useMutation({
    mutationFn: (template) => api.post("/api/grade-scales", { template }).then((r) => r.data),
    onSuccess: (d) => {
      toast.success(`${d.scale.name} added`);
      setOpen(d.scale.id);
      refresh();
    },
    onError: err,
  });
  const setDefault = useMutation({
    mutationFn: (gradeScaleId) => api.put("/api/grade-scales/default", { gradeScaleId }),
    onSuccess: () => {
      toast.success("School default saved");
      refresh();
    },
    onError: err,
  });
  const assign = useMutation({
    mutationFn: ({ classId, gradeScaleId }) => api.put("/api/grade-scales/assign", { classIds: [classId], gradeScaleId }),
    onSuccess: refresh,
    onError: err,
  });
  const retire = useMutation({
    mutationFn: (id) => api.delete(`/api/grade-scales/${id}`),
    onSuccess: () => {
      toast.success("Scale removed");
      refresh();
    },
    onError: err,
  });

  const scales = q.data?.scales || [];
  const templates = q.data?.templates || [];
  const scaleOfClass = useMemo(() => {
    const m = new Map();
    for (const s of scales) for (const id of s.classIds) m.set(id, s.id);
    return m;
  }, [scales]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Grading scales</CardTitle>
        <CardDescription>
          How marks become grades on results and report cards. Use CBE rubric levels for Grades 1–9 and KCSE letter grades
          for Forms 3–4, or edit the bands to match your school. Changes don&apos;t alter results already published.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <Button key={t.key} size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate(t.key)}>
              Add {t.name}
            </Button>
          ))}
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">School default</div>
          <select
            aria-label="School default grading scale"
            className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
            value={q.data?.defaultGradeScaleId || ""}
            onChange={(e) => setDefault.mutate(e.target.value || null)}
          >
            <option value="">Built-in A–E</option>
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {scales.map((s) => (
          <div key={s.id} className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium flex items-center gap-2">
                {s.name}
                <Badge variant="outline">{s.overallBy === "POINTS" ? "Overall by mean points" : "Overall by average mark"}</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? "Close" : "Edit bands"}
                </Button>
                <Button size="sm" variant="outline" disabled={retire.isPending} onClick={() => retire.mutate(s.id)}>
                  Remove
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {s.bands.map((b) => `${b.label} ${b.minScore}–${b.maxScore}`).join(" · ")}
            </div>
            {open === s.id && <BandsEditor key={s.id + s.bands.length} scale={s} onSaved={refresh} />}
          </div>
        ))}

        {(classesQ.data || []).length > 0 && scales.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Scale per class ({currentYear})</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(classesQ.data || []).map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{classLabel(c)}</span>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    value={scaleOfClass.get(c.id) || ""}
                    onChange={(e) => assign.mutate({ classId: c.id, gradeScaleId: e.target.value || null })}
                  >
                    <option value="">School default</option>
                    {scales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
