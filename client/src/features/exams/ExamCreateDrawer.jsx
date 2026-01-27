// src/features/exams/ExamCreateDrawer.jsx
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createExamSession, listExamTypes, createExamType } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, PlusCircle, Calendar, BookOpen, Users, X, Check } from "lucide-react";

const TERMS = [
  { value: "TERM1", label: "Term 1" },
  { value: "TERM2", label: "Term 2" },
  { value: "TERM3", label: "Term 3" },
];

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
  const [activeTab, setActiveTab] = useState("session");

  const [typeForm, setTypeForm] = useState({
    name: "",
    code: "",
    weight: "",
  });

  const [form, setForm] = useState({
    name: "",
    year: defaultYear ?? new Date().getFullYear(),
    term: String(defaultTerm ?? "TERM1").toUpperCase(),
    classId: "",
    examTypeId: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm((p) => ({
      ...p,
      year: p.year ?? (defaultYear ?? new Date().getFullYear()),
      term: String(p.term || defaultTerm || "TERM1").toUpperCase(),
    }));
  }, [open, defaultYear, defaultTerm]);

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
        value: String(c.id),
      })),
    [classes]
  );

  const canSubmit =
    form.name.trim().length > 0 &&
    isValidYear(form.year) &&
    TERMS.some(t => t.value === String(form.term || "").toUpperCase()) &&
    String(form.classId || "").trim().length > 0 &&
    String(form.examTypeId || "").trim().length > 0;

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
      setForm({
        name: "",
        year: defaultYear ?? new Date().getFullYear(),
        term: String(defaultTerm ?? "TERM1").toUpperCase(),
        classId: "",
        examTypeId: "",
      });
      qc.invalidateQueries({ queryKey: ["examSessions"], exact: false });
      onCreated?.();
    },
  });

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
        weight: parsed,
      };

      return createExamType(payload);
    },
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ["examTypes"] });
      const createdId = created?.id ? String(created.id) : null;
      if (createdId) {
        setForm((p) => ({ ...p, examTypeId: createdId }));
        setActiveTab("session");
      }
      setTypeForm({ name: "", code: "", weight: "" });
      typesQ.refetch();
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <PlusCircle className="h-4 w-4" />
        Create Exam Session
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Create Exam Session
            </DialogTitle>
            <DialogDescription>
              Create a new exam session by selecting class, term, year, and exam type.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="session" className="gap-2">
                <Calendar className="h-4 w-4" />
                Exam Session
              </TabsTrigger>
              <TabsTrigger value="type" className="gap-2">
                <BookOpen className="h-4 w-4" />
                Exam Type
              </TabsTrigger>
            </TabsList>

            <TabsContent value="session" className="space-y-6 pt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="session-name">Session Name *</Label>
                  <Input
                    id="session-name"
                    placeholder="e.g., Grade 4A Midterm 2026"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    A descriptive name for this exam session
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year">Year *</Label>
                    <Input
                      id="year"
                      type="number"
                      min="2000"
                      max="2100"
                      placeholder="2026"
                      value={form.year}
                      onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                    />
                    {!isValidYear(form.year) && (
                      <p className="text-xs text-destructive">
                        Year must be between 2000 and 2100
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="term">Term *</Label>
                    <Select
                      value={form.term}
                      onValueChange={(value) => setForm((p) => ({ ...p, term: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select term" />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMS.map((term) => (
                          <SelectItem key={term.value} value={term.value}>
                            {term.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="class">Class *</Label>
                  <Select
                    value={form.classId}
                    onValueChange={(value) => setForm((p) => ({ ...p, classId: value }))}
                    disabled={classesQ.isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={classesQ.isLoading ? "Loading classes..." : "Select class"} />
                    </SelectTrigger>
                    <SelectContent>
                      {classOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            {option.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {classesQ.isError && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        Failed to load classes: {apiErrMsg(classesQ.error)}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="exam-type">Exam Type *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab("type")}
                      className="h-auto p-0 text-xs"
                    >
                      <PlusCircle className="h-3 w-3 mr-1" />
                      Create new type
                    </Button>
                  </div>
                  <Select
                    value={form.examTypeId}
                    onValueChange={(value) => setForm((p) => ({ ...p, examTypeId: value }))}
                    disabled={typesQ.isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={typesQ.isLoading ? "Loading types..." : "Select exam type"} />
                    </SelectTrigger>
                    <SelectContent>
                      {examTypes.map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          <div className="flex items-center justify-between w-full">
                            <div>
                              <div className="font-medium">{type.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {type.code && `Code: ${type.code} • `}Weight: {type.weight ?? "—"}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[10px]">
                              {type.weight || 0}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {typesQ.isError && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        Failed to load exam types: {apiErrMsg(typesQ.error)}
                      </AlertDescription>
                    </Alert>
                  )}
                  {!examTypes.length && !typesQ.isLoading && (
                    <div className="text-xs text-muted-foreground">
                      No exam types found. Create one first.
                    </div>
                  )}
                </div>

                {createSessionMut.isError && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Failed to create session: {apiErrMsg(createSessionMut.error)}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>

            <TabsContent value="type" className="space-y-6 pt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="type-name">Exam Type Name *</Label>
                  <Input
                    id="type-name"
                    placeholder="e.g., MIDTERM"
                    value={typeForm.name}
                    onChange={(e) => setTypeForm((p) => ({ ...p, name: e.target.value }))}
                    disabled={createTypeMut.isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type-code">Code (Optional)</Label>
                  <Input
                    id="type-code"
                    placeholder="e.g., MID"
                    value={typeForm.code}
                    onChange={(e) => setTypeForm((p) => ({ ...p, code: e.target.value }))}
                    disabled={createTypeMut.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    A short code for this exam type
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type-weight">Weight (Optional)</Label>
                  <Input
                    id="type-weight"
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    placeholder="0.3"
                    value={typeForm.weight}
                    onChange={(e) => setTypeForm((p) => ({ ...p, weight: e.target.value }))}
                    disabled={createTypeMut.isPending}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Used for aggregation (e.g., CAT 0.3 + ENDTERM 0.7)
                    </p>
                    {typeForm.weight && (
                      <Badge variant={parseWeightInput(typeForm.weight)?.error ? "destructive" : "secondary"}>
                        {parseWeightInput(typeForm.weight)?.error ? "Invalid" : "Valid"}
                      </Badge>
                    )}
                  </div>
                </div>

                {createTypeMut.isError && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {apiErrMsg(createTypeMut.error)}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createSessionMut.isPending || createTypeMut.isPending}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>

            <div className="flex gap-2">
              {activeTab === "type" && (
                <Button
                  onClick={() => setActiveTab("session")}
                  variant="outline"
                  disabled={createTypeMut.isPending}
                >
                  Back to Session
                </Button>
              )}

              {activeTab === "type" ? (
                <Button
                  onClick={() => createTypeMut.mutate()}
                  disabled={createTypeMut.isPending || !String(typeForm.name || "").trim()}
                  className="gap-2"
                >
                  {createTypeMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="h-4 w-4" />
                      Create Type
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => createSessionMut.mutate()}
                  disabled={!canSubmit || createSessionMut.isPending}
                  className="gap-2"
                >
                  {createSessionMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Create Session
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}