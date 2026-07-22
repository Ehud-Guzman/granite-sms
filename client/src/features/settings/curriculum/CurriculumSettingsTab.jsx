// client/src/features/settings/curriculum/CurriculumSettingsTab.jsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { listClasses } from "@/api/classes.api";
import { listTeachers } from "@/api/teachers.api";
import {
  listSubjects,
  createSubject,
  updateSubject,
  deactivateSubject,
} from "@/api/subjects.api";
import {
  listAssignments,
  createAssignment,
  deactivateAssignment,
} from "@/api/assignments.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { confirmAction } from "@/lib/confirm-store";

function niceFromEmail(email) {
  const raw = String(email || "").split("@")[0] || "";
  if (!raw) return "";
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function teacherUserLabel(u) {
  const first = u?.teacher?.firstName || "";
  const last = u?.teacher?.lastName || "";
  const full = `${first} ${last}`.trim();
  return full || niceFromEmail(u?.email) || u?.email || "Teacher";
}

function assignmentTeacherLabel(t) {
  const full = `${t?.firstName || ""} ${t?.lastName || ""}`.trim();
  return full || niceFromEmail(t?.user?.email) || t?.user?.email || "Unassigned";
}

export default function CurriculumSettingsTab() {
  const qc = useQueryClient();

  // ---------------- Subjects ----------------
  const subjectsQ = useQuery({
    queryKey: ["subjects"],
    queryFn: listSubjects,
    staleTime: 30_000,
  });
  const subjects = Array.isArray(subjectsQ.data) ? subjectsQ.data : [];

  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const createSubjectMut = useMutation({
    mutationFn: createSubject,
    onSuccess: () => {
      toast.success("Subject created");
      qc.invalidateQueries({ queryKey: ["subjects"] });
      setNewName("");
      setNewCode("");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to create subject"),
  });

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const openEdit = (s) => {
    setEditingId(s.id);
    setEditName(s.name || "");
    setEditCode(s.code || "");
  };
  const closeEdit = () => setEditingId(null);

  const updateSubjectMut = useMutation({
    mutationFn: ({ id, payload }) => updateSubject(id, payload),
    onSuccess: () => {
      toast.success("Subject updated");
      qc.invalidateQueries({ queryKey: ["subjects"] });
      closeEdit();
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to update subject"),
  });

  const deactivateSubjectMut = useMutation({
    mutationFn: deactivateSubject,
    onSuccess: () => {
      toast.success("Subject deactivated");
      qc.invalidateQueries({ queryKey: ["subjects"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to deactivate subject"),
  });

  // ---------------- Teaching Assignments ----------------
  const classesQ = useQuery({ queryKey: ["classes"], queryFn: () => listClasses({}) });
  const teachersQ = useQuery({ queryKey: ["teacher-users"], queryFn: listTeachers });
  const assignmentsQ = useQuery({
    queryKey: ["assignments"],
    queryFn: () => listAssignments(),
    staleTime: 30_000,
  });

  const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
  const teacherUsers = Array.isArray(teachersQ.data) ? teachersQ.data : [];
  const assignments = Array.isArray(assignmentsQ.data) ? assignmentsQ.data : [];

  const [teacherId, setTeacherId] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const createAssignmentMut = useMutation({
    mutationFn: createAssignment,
    onSuccess: () => {
      toast.success("Assignment created");
      qc.invalidateQueries({ queryKey: ["assignments"] });
      setTeacherId("");
      setClassId("");
      setSubjectId("");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to create assignment"),
  });

  const deactivateAssignmentMut = useMutation({
    mutationFn: deactivateAssignment,
    onSuccess: () => {
      toast.success("Assignment removed");
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to remove assignment"),
  });

  const grouped = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      const key = a.classId;
      if (!map.has(key)) {
        map.set(key, {
          classLabel: a.class
            ? `${a.class.name}${a.class.stream ? ` ${a.class.stream}` : ""} (${a.class.year})`
            : "Class",
          rows: [],
        });
      }
      map.get(key).rows.push(a);
    }
    return Array.from(map.values());
  }, [assignments]);

  const canCreateAssignment = !!(teacherId && classId && subjectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Curriculum</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage subjects and teacher / class / subject teaching assignments
        </p>
      </div>

      {/* Subjects */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subjects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Subject name (e.g. Mathematics)"
            />
            <Input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Code (optional)"
            />
            <Button
              onClick={() => createSubjectMut.mutate({ name: newName, code: newCode })}
              disabled={!newName.trim() || createSubjectMut.isPending}
            >
              {createSubjectMut.isPending ? "Adding…" : "Add subject"}
            </Button>
          </div>

          <Separator />

          {subjectsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading subjects…</div>
          ) : subjectsQ.isError ? (
            <div className="text-sm text-destructive">
              {subjectsQ.error?.response?.data?.message || "Failed to load subjects."}
            </div>
          ) : subjects.length === 0 ? (
            <div className="text-sm text-muted-foreground">No subjects yet. Add one above.</div>
          ) : (
            <div className="grid gap-2">
              {subjects.map((s) => {
                const isEditing = editingId === s.id;
                return (
                  <div key={s.id} className="border rounded-md p-3 bg-background">
                    {isEditing ? (
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="md:flex-1"
                        />
                        <Input
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          placeholder="Code"
                          className="md:w-32"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              updateSubjectMut.mutate({
                                id: s.id,
                                payload: { name: editName, code: editCode || null },
                              })
                            }
                            disabled={!editName.trim() || updateSubjectMut.isPending}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={closeEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{s.name}</span>
                          {s.code && (
                            <span className="ml-2 text-xs text-muted-foreground font-mono">
                              {s.code}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: "Deactivate subject?",
                                description: `Deactivate "${s.name}"? It won't be selectable for new assignments.`,
                                confirmLabel: "Deactivate",
                                variant: "destructive",
                              });
                              if (ok) deactivateSubjectMut.mutate(s.id);
                            }}
                            disabled={deactivateSubjectMut.isPending}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teaching Assignments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Teaching Assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">Select teacher…</option>
              {teacherUsers.map((u) => (
                <option key={u.id} value={u.teacher?.id || ""} disabled={!u.teacher?.id}>
                  {teacherUserLabel(u)}
                  {!u.teacher?.id ? " (no profile)" : ""}
                </option>
              ))}
            </select>

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

            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Select subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <Button
              onClick={() => createAssignmentMut.mutate({ teacherId, classId, subjectId })}
              disabled={!canCreateAssignment || createAssignmentMut.isPending}
            >
              {createAssignmentMut.isPending ? "Assigning…" : "Assign"}
            </Button>
          </div>

          <Separator />

          {assignmentsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading assignments…</div>
          ) : assignmentsQ.isError ? (
            <div className="text-sm text-destructive">
              {assignmentsQ.error?.response?.data?.message || "Failed to load assignments."}
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-sm text-muted-foreground">No teaching assignments yet.</div>
          ) : (
            <div className="grid gap-3">
              {grouped.map((g) => (
                <div key={g.classLabel} className="border rounded-md p-3 bg-background">
                  <div className="font-medium mb-2">{g.classLabel}</div>
                  <div className="grid gap-1">
                    {g.rows.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-sm">
                        <div>
                          <span>{a.subject?.name || "Subject"}</span>
                          <span className="mx-2 text-muted-foreground">•</span>
                          <span className="text-muted-foreground">
                            {assignmentTeacherLabel(a.teacher)}
                          </span>
                          {a.teacher?.user?.isActive === false && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              INACTIVE TEACHER
                            </Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const ok = await confirmAction({
                              title: "Remove assignment?",
                              description: `Remove ${a.subject?.name || "this subject"} from ${g.classLabel}?`,
                              confirmLabel: "Remove",
                              variant: "destructive",
                            });
                            if (ok) deactivateAssignmentMut.mutate(a.id);
                          }}
                          disabled={deactivateAssignmentMut.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
