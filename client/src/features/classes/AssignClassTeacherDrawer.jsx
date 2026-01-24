// client/src/features/classes/AssignClassTeacherDrawer.jsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";

// ---------------------------
// helpers
// ---------------------------
function asStr(v) {
  return String(v ?? "").trim();
}
function normalize(v) {
  return asStr(v).toLowerCase();
}
function teacherLabel(t) {
  const full = `${t?.firstName || ""} ${t?.lastName || ""}`.trim();
  return full || t?.name || t?.user?.email || t?.email || "Teacher";
}
function teacherMeta(t) {
  const email = t?.user?.email || t?.email || "";
  const phone = t?.phone || "";
  return [email, phone].filter(Boolean).join(" • ") || "—";
}

// ---------------------------
// API helpers
// ---------------------------
async function listTeachers() {
  const { data } = await api.get("/api/teachers");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.teachers)) return data.teachers;
  return [];
}

async function listClassTeachers() {
  const { data } = await api.get("/api/class-teachers");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

// ✅ Backend: POST /api/class-teachers { classId, teacherId }
async function assignClassTeacher({ classId, teacherId }) {
  const { data } = await api.post("/api/class-teachers", { classId, teacherId });
  return data;
}

export default function AssignClassTeacherDrawer({
  classId,
  classLabel,
  children,
}) {
  const qc = useQueryClient();

  // Hooks must ALWAYS run
  const { data: meData, isLoading: meLoading } = useMe();

  const role = useMemo(() => {
    return String(meData?.user?.role || "").toUpperCase();
  }, [meData?.user?.role]);

  const canUse = role === "ADMIN";

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  // Only fetch when:
  // - drawer is open
  // - user is ADMIN
  const canFetch = open && canUse;

  const teachersQ = useQuery({
    queryKey: ["teachers"],
    queryFn: listTeachers,
    enabled: canFetch,
    retry: false,
    staleTime: 60_000,
  });

  const classTeachersQ = useQuery({
    queryKey: ["class-teachers"],
    queryFn: listClassTeachers,
    enabled: canFetch,
    retry: false,
    staleTime: 60_000,
  });

  const currentAssignment = useMemo(() => {
    const rows = Array.isArray(classTeachersQ.data) ? classTeachersQ.data : [];
    const cid = String(classId || "");
    if (!cid) return null;
    return rows.find((r) => String(r?.classId) === cid) || null;
  }, [classTeachersQ.data, classId]);

  const currentTeacherId = useMemo(() => {
    return currentAssignment?.teacherId ? String(currentAssignment.teacherId) : "";
  }, [currentAssignment?.teacherId]);

  const currentTeacherName = useMemo(() => {
    const t = currentAssignment?.teacher;
    return t ? teacherLabel(t) : null;
  }, [currentAssignment]);

  // When opened, preselect current teacher
  useEffect(() => {
    if (!open) return;
    if (!canUse) return;

    if (currentTeacherId) setSelectedTeacherId(currentTeacherId);
    else setSelectedTeacherId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canUse, currentTeacherId]);

  const filteredTeachers = useMemo(() => {
    const list = Array.isArray(teachersQ.data) ? teachersQ.data : [];
    const needle = normalize(search);
    if (!needle) return list;

    return list.filter((t) => {
      const blob = normalize(
        `${teacherLabel(t)} ${t?.email || ""} ${t?.user?.email || ""} ${t?.phone || ""}`
      );
      return blob.includes(needle);
    });
  }, [teachersQ.data, search]);

  const assignMut = useMutation({
    mutationFn: assignClassTeacher,
    onSuccess: () => {
      toast.success("Class teacher updated");

      qc.invalidateQueries({ queryKey: ["classes"] });
      qc.invalidateQueries({ queryKey: ["class-teachers"] });
      qc.invalidateQueries({ queryKey: ["teachers"] });

      setOpen(false);
      setSearch("");
      setSelectedTeacherId("");
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || "Failed to assign teacher");
    },
  });

  const busy =
    assignMut.isPending ||
    teachersQ.isFetching ||
    classTeachersQ.isFetching;

  const onAssign = () => {
    if (!canUse) return toast.error("Forbidden");
    const tId = asStr(selectedTeacherId);
    const cId = asStr(classId);

    if (!cId) return toast.error("Missing classId");
    if (!tId) return toast.error("Select a teacher first");

    assignMut.mutate({ classId: cId, teacherId: tId });
  };

  const onClose = () => {
    setOpen(false);
    setSearch("");
    setSelectedTeacherId("");
  };

  // ✅ No early returns before hooks.
  // UI hiding happens down here, safely.
  if (meLoading) {
    // Still render trigger for layout stability, but disable it
    return children ? (
      <span className="inline-block opacity-60 pointer-events-none">{children}</span>
    ) : (
      <Button variant="outline" disabled>
        Assign class teacher
      </Button>
    );
  }

  if (!canUse) {
    // Not admin → render nothing (or children if you want)
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children || <Button variant="outline">Assign class teacher</Button>}
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:w-[520px]">
        <SheetHeader>
          <SheetTitle>Assign Class Teacher</SheetTitle>
          <SheetDescription>
            Pick one teacher for this class (tenant-safe). This updates the current assignment.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {/* Class summary */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Class</div>
                  <div className="font-medium truncate">{classLabel || "Selected class"}</div>
                </div>
                <Badge variant="secondary" className="text-[10px] uppercase">
                  ADMIN
                </Badge>
              </div>

              <Separator className="my-2" />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current teacher</span>
                <span className="font-medium">
                  {classTeachersQ.isLoading ? "Loading…" : currentTeacherName || "None assigned"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Search */}
          <div className="space-y-2">
            <Label>Search teachers</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
            />
          </div>

          {/* Teachers list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Select teacher</Label>
              <span className="text-xs text-muted-foreground">
                {teachersQ.isLoading ? "Loading…" : `${filteredTeachers.length} found`}
              </span>
            </div>

            <div className="rounded-md border bg-background max-h-[340px] overflow-auto">
              {teachersQ.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading teachers…</div>
              ) : teachersQ.isError ? (
                <div className="p-4 text-sm">
                  <div className="font-medium">Failed to load teachers</div>
                  <div className="text-muted-foreground mt-1">
                    {teachersQ.error?.response?.data?.message ||
                      teachersQ.error?.message ||
                      "Server error"}
                  </div>
                </div>
              ) : filteredTeachers.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No teachers match your search.
                </div>
              ) : (
                filteredTeachers.map((t) => {
                  const id = String(t?.id || "");
                  const isSelected = id === String(selectedTeacherId);
                  const isCurrent = id && id === currentTeacherId;

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedTeacherId(id)}
                      className={[
                        "w-full text-left p-3 border-b last:border-b-0 flex items-start justify-between gap-3",
                        isSelected ? "bg-muted" : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          <span className="truncate">{teacherLabel(t)}</span>
                          {isCurrent ? (
                            <Badge variant="secondary" className="text-[10px]">
                              CURRENT
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 break-words">
                          {teacherMeta(t)}
                        </div>
                      </div>

                      {isSelected ? <Badge className="text-[10px]">SELECTED</Badge> : null}
                    </button>
                  );
                })
              )}
            </div>

            {currentTeacherId &&
            selectedTeacherId &&
            selectedTeacherId !== currentTeacherId ? (
              <div className="text-xs text-muted-foreground">
                You’re changing the current assignment.
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>

            <Button onClick={onAssign} disabled={busy || !selectedTeacherId}>
              {assignMut.isPending ? "Saving…" : currentTeacherId ? "Update teacher" : "Assign teacher"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
