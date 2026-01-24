// src/features/exams/ExamCreateDrawer.jsx
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createExamSession, listExamTypes, createExamType } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const TERMS = ["TERM1", "TERM2", "TERM3"];

function fmtClass(c) {
  return c?.name
    ? `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`
    : String(c?.id || "");
}

function apiErrMsg(err) {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    "Request failed"
  );
}

function isValidYear(y) {
  const n = Number(y);
  return Number.isFinite(n) && n >= 2000 && n <= 2100;
}

function parseWeightInput(v) {
  // allow blank => null
  const s = String(v ?? "").trim();
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return { error: "Weight must be a number." };
  if (n <= 0 || n > 1) return { error: "Weight must be between (0, 1]." };

  return n;
}

export default function ExamCreateDrawer({ defaultYear, defaultTerm, onCreated }) {
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);

  // create type modal
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeForm, setTypeForm] = useState(() => ({
    name: "",
    code: "",
    weight: "", // string input; parsed to number|null
  }));

  const [form, setForm] = useState(() => ({
    name: "",
    year: defaultYear ?? new Date().getFullYear(),
    term: String(defaultTerm ?? "TERM1").toUpperCase(),
    classId: "",
    examTypeId: "",
  }));

  // When opening drawer, prefill year/term nicely (but don't fight user edits)
  useEffect(() => {
    if (!open) return;
    setForm((p) => ({
      ...p,
      year: p.year ?? (defaultYear ?? new Date().getFullYear()),
      term: String(p.term || defaultTerm || "TERM1").toUpperCase(),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Queries: only run when open
  const typesQ = useQuery({
    queryKey: ["examTypes"],
    queryFn: listExamTypes,
    enabled: open,
    retry: false,
  });

  const classesQ = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => listClasses({ active: true }),
    enabled: open,
    retry: false,
  });

  const examTypes = Array.isArray(typesQ.data) ? typesQ.data : [];
  const classes = Array.isArray(classesQ.data) ? classesQ.data : [];

  const classOptions = useMemo(
    () =>
      classes.map((c) => ({
        id: String(c.id),
        label: fmtClass(c),
      })),
    [classes]
  );

  const canSubmit =
    form.name.trim().length > 0 &&
    isValidYear(form.year) &&
    TERMS.includes(String(form.term || "").toUpperCase()) &&
    String(form.classId || "").trim().length > 0 &&
    String(form.examTypeId || "").trim().length > 0;

  // ---- Create session mutation
  const createSessionMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        year: Number(form.year),
        term: String(form.term || "").trim().toUpperCase(),
        classId: String(form.classId),
        examTypeId: String(form.examTypeId),
      };
      return createExamSession(payload);
    },
    onSuccess: () => {
      setOpen(false);
      setForm((p) => ({
        ...p,
        name: "",
        classId: "",
        examTypeId: "",
      }));

      // refresh session lists wherever you use them
      qc.invalidateQueries({ queryKey: ["examSessions"], exact: false });
      onCreated?.();
    },
  });

  // ---- Create exam type mutation
  const createTypeMut = useMutation({
    mutationFn: async () => {
      const name = String(typeForm.name || "").trim();
      const code = String(typeForm.code || "").trim();

      if (!name) throw new Error("Exam type name is required.");

      const parsed = parseWeightInput(typeForm.weight);
      if (parsed && typeof parsed === "object" && parsed.error) {
        throw new Error(parsed.error);
      }

      const payload = {
        name,
        code: code ? code.toUpperCase() : null,
        weight: parsed, // number | null
      };

      return createExamType(payload);
    },
    onSuccess: async (created) => {
      // refresh types then auto-select new one
      await qc.invalidateQueries({ queryKey: ["examTypes"] });

      const createdId = created?.id ? String(created.id) : null;
      if (createdId) {
        setForm((p) => ({ ...p, examTypeId: createdId }));
      }

      setTypeOpen(false);
      setTypeForm({ name: "", code: "", weight: "" });
      typesQ.refetch();
    },
  });

  const typesLoadingState = (() => {
    if (typesQ.isLoading) return { label: "Loading types…" };
    if (typesQ.isError) return { label: `Failed to load types: ${apiErrMsg(typesQ.error)}` };
    if (!examTypes.length) return { label: "No exam types found — create one." };
    return null;
  })();

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create session</Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle>Create Exam Session</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    A session = Class + Term + Year + Exam Type.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    exams
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Session name */}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Session name</div>
                <Input
                  placeholder="e.g. Grade 4A Midterm 2026"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>

              {/* Year + Term */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Year</div>
                  <Input
                    placeholder="2026"
                    value={form.year}
                    onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                  />
                  {!isValidYear(form.year) ? (
                    <div className="text-[11px] text-destructive">
                      Year must be between 2000 and 2100.
                    </div>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Term</div>
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={form.term}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, term: String(e.target.value).toUpperCase() }))
                    }
                  >
                    {TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Actions</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setTypeOpen(true)}
                    disabled={createTypeMut.isPending}
                  >
                    + Create exam type
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Class */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Class</div>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm w-full"
                  value={form.classId}
                  onChange={(e) => setForm((p) => ({ ...p, classId: e.target.value }))}
                  disabled={classesQ.isLoading}
                >
                  <option value="">
                    {classesQ.isLoading ? "Loading classes…" : "Select class…"}
                  </option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {classesQ.isError ? (
                  <div className="text-sm text-destructive">
                    Failed to load classes: {apiErrMsg(classesQ.error)}
                  </div>
                ) : null}
              </div>

              {/* Exam type */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Exam type</div>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm w-full"
                  value={form.examTypeId}
                  onChange={(e) => setForm((p) => ({ ...p, examTypeId: e.target.value }))}
                  disabled={typesQ.isLoading}
                >
                  <option value="">Select type…</option>

                  {typesLoadingState ? (
                    <option value="" disabled>
                      {typesLoadingState.label}
                    </option>
                  ) : (
                    examTypes.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}
                        {t.code ? ` (${t.code})` : ""} — weight {t.weight ?? "—"}
                      </option>
                    ))
                  )}
                </select>

                {typesQ.isError ? (
                  <div className="text-sm text-destructive">
                    Failed to load exam types: {apiErrMsg(typesQ.error)}
                  </div>
                ) : null}

                {!examTypes.length && !typesQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">
                    You need at least one exam type before creating sessions.
                  </div>
                ) : null}
              </div>

              {/* Footer buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={createSessionMut.isPending}
                >
                  Cancel
                </Button>

                <Button
                  onClick={() => createSessionMut.mutate()}
                  disabled={!canSubmit || createSessionMut.isPending}
                >
                  {createSessionMut.isPending ? "Creating…" : "Create session"}
                </Button>
              </div>

              {/* Create session error */}
              {createSessionMut.isError ? (
                <div className="text-sm text-destructive">
                  Failed to create session: {apiErrMsg(createSessionMut.error)}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Exam Type Dialog */}
      <Dialog open={typeOpen} onOpenChange={setTypeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create exam type</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Name</div>
              <Input
                value={typeForm.name}
                onChange={(e) => setTypeForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. MIDTERM"
                disabled={createTypeMut.isPending}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Code (optional)</div>
              <Input
                value={typeForm.code}
                onChange={(e) => setTypeForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="e.g. MID"
                disabled={createTypeMut.isPending}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Weight (optional)</div>
              <Input
                value={typeForm.weight}
                onChange={(e) => setTypeForm((p) => ({ ...p, weight: e.target.value }))}
                placeholder="0.3 (between 0 and 1). Leave blank for none."
                disabled={createTypeMut.isPending}
              />
              <div className="text-[11px] text-muted-foreground">
                Weight is used for future aggregation (e.g. CAT 0.3 + ENDTERM 0.7).
              </div>
            </div>

            {createTypeMut.isError ? (
              <div className="text-sm text-destructive">
                {apiErrMsg(createTypeMut.error)}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTypeOpen(false)}
              disabled={createTypeMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createTypeMut.mutate()}
              disabled={createTypeMut.isPending || !String(typeForm.name || "").trim()}
            >
              {createTypeMut.isPending ? "Creating…" : "Create type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
