// client/src/features/classes/AssignClassTeacherDrawer.jsx
import { useMemo, useState } from "react";
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
const asStr = (v) => String(v ?? "").trim();
const normalize = (v) => asStr(v).toLowerCase();

function niceFromEmail(email) {
  const raw = String(email || "").split("@")[0] || "";
  if (!raw) return "";
  // kalunde.kmt_12 -> Kalunde Kmt 12
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * We are listing TEACHERS from /api/users?role=TEACHER (User records).
 * Shape (from your response):
 * { id, email, role, isActive, schoolId, ... }
 */
function userTeacherLabel(u) {
  const first = u?.firstName || "";
  const last = u?.lastName || "";
  const full = `${first} ${last}`.trim();
  const email = u?.email || "";
  return full || niceFromEmail(email) || email || "Teacher";
}

function userTeacherMeta(u) {
  const email = u?.email || "";
  const phone = u?.phone || "";
  const inactive = u?.isActive === false ? "Inactive" : "";
  return [email, phone, inactive].filter(Boolean).join(" • ") || "—";
}

// ---------------------------
// API helpers
// ---------------------------

// Teachers list = USERS with role TEACHER (this matches your actual data)
async function listTeacherUsers() {
  const { data } = await api.get("/api/users", { params: { role: "TEACHER" } });
  const users = data?.users ?? data;
  return Array.isArray(users) ? users : [];
}

async function listClassTeachers() {
  const { data } = await api.get("/api/class-teachers");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

// Backend now accepts teacherId as:
// - Teacher.id OR Teacher.userId OR User.id(role=TEACHER) (auto-create teacher profile)
async function assignClassTeacher({ classId, teacherId }) {
  const { data } = await api.post("/api/class-teachers", { classId, teacherId });
  return data;
}

export default function AssignClassTeacherDrawer({ classId, classLabel, children }) {
  const qc = useQueryClient();
  const { data: meData, isLoading: meLoading } = useMe();

  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  const tenantId = asStr(meData?.user?.schoolId || meData?.schoolId || "");
  const canUse = role === "ADMIN";

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const canFetch = open && canUse && !!tenantId;

  const teachersQ = useQuery({
    queryKey: ["teacher-users", tenantId],
    queryFn: listTeacherUsers,
    enabled: canFetch,
    retry: false,
    staleTime: 60_000,
  });

  const classTeachersQ = useQuery({
    queryKey: ["class-teachers", tenantId],
    queryFn: listClassTeachers,
    enabled: canFetch,
    retry: false,
    staleTime: 60_000,
  });

  // current assignment (from /api/class-teachers)
  const currentAssignment = useMemo(() => {
    const rows = Array.isArray(classTeachersQ.data) ? classTeachersQ.data : [];
    const cid = asStr(classId);
    if (!cid) return null;
    return rows.find((r) => asStr(r?.classId) === cid) || null;
  }, [classTeachersQ.data, classId]);

  /**
   * IMPORTANT:
   * In DB, ClassTeacher.teacherId stores Teacher.id.
   * Your UI list is User.id.
   *
   * But backend includes: { teacher: { user: { email } } }
   * So we can match "current teacher" by comparing email against the teacher user email.
   */
  const currentTeacherEmail =
    currentAssignment?.teacher?.user?.email ||
    currentAssignment?.teacher?.email || // just in case
    "";

  // Find current teacher user id (User.id) by email match
  const currentTeacherUserId = useMemo(() => {
    const list = Array.isArray(teachersQ.data) ? teachersQ.data : [];
    if (!currentTeacherEmail) return "";
    const hit = list.find((u) => normalize(u?.email) === normalize(currentTeacherEmail));
    return hit?.id ? asStr(hit.id) : "";
  }, [teachersQ.data, currentTeacherEmail]);

  const currentTeacherName = useMemo(() => {
    // Prefer teacher profile names if present, else email-derived
    const t = currentAssignment?.teacher;
    const first = t?.firstName || "";
    const last = t?.lastName || "";
    const full = `${first} ${last}`.trim();
    const email = t?.user?.email || "";
    return full || niceFromEmail(email) || email || null;
  }, [currentAssignment]);

  // Effective selection: user click overrides, otherwise show current user id (mapped)
  const effectiveTeacherId = selectedTeacherId || currentTeacherUserId;

  const filteredTeachers = useMemo(() => {
    const list = Array.isArray(teachersQ.data) ? teachersQ.data : [];
    const needle = normalize(search);
    if (!needle) return list;

    return list.filter((u) => {
      const blob = normalize(`${userTeacherLabel(u)} ${u?.email || ""} ${u?.phone || ""}`);
      return blob.includes(needle);
    });
  }, [teachersQ.data, search]);

  const assignMut = useMutation({
    mutationFn: assignClassTeacher,
    onSuccess: () => {
      toast.success(currentTeacherUserId ? "Class teacher updated" : "Class teacher assigned");

      qc.invalidateQueries({ queryKey: ["classes"] });
      qc.invalidateQueries({ queryKey: ["class-teachers", tenantId] });
      qc.invalidateQueries({ queryKey: ["teacher-users", tenantId] });

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

    const cId = asStr(classId);
    const tId = asStr(effectiveTeacherId); // ✅ this is User.id today

    if (!cId) return toast.error("Missing classId");
    if (!tId) return toast.error("Select a teacher first");

    if (tId === currentTeacherUserId) {
      toast.message("No changes to save.");
      return;
    }

    assignMut.mutate({ classId: cId, teacherId: tId });
  };

  const onClose = () => {
    setOpen(false);
    setSearch("");
    setSelectedTeacherId("");
  };

  const onOpenChange = (next) => {
    setOpen(next);
    if (next) {
      setSearch("");
      setSelectedTeacherId(""); // resets so default uses current
    }
  };

  if (meLoading) {
    return children ? (
      <span className="inline-block opacity-60 pointer-events-none">{children}</span>
    ) : (
      <Button variant="outline" disabled>
        Assign class teacher
      </Button>
    );
  }

  if (!canUse) return null;

  if (!tenantId) {
    return (
      <Button
        variant="outline"
        onClick={() => toast.error("Missing school context (tenantId).")}
      >
        Assign class teacher
      </Button>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        {children || <Button variant="outline">Assign class teacher</Button>}
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:w-[520px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Assign Class Teacher</SheetTitle>
          <SheetDescription>
            Pick one teacher user (role=TEACHER) for this class.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-5 space-y-4">
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
                  {classTeachersQ.isLoading
                    ? "Loading…"
                    : currentTeacherName || "None assigned"}
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
                filteredTeachers.map((u) => {
                  const id = asStr(u?.id); // ✅ User.id
                  const isSelected = id && id === asStr(effectiveTeacherId);
                  const isCurrent = id && id === asStr(currentTeacherUserId);
                  const inactive = u?.isActive === false;

                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={inactive}
                      onClick={() => {
                        if (inactive) return;
                        setSelectedTeacherId(id);
                      }}
                      className={[
                        "w-full text-left p-3 border-b last:border-b-0 flex items-start justify-between gap-3",
                        inactive ? "opacity-60 cursor-not-allowed" : "",
                        isSelected ? "bg-muted" : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          <span className="truncate">{userTeacherLabel(u)}</span>
                          {isCurrent ? (
                            <Badge variant="secondary" className="text-[10px]">
                              CURRENT
                            </Badge>
                          ) : null}
                          {inactive ? (
                            <Badge variant="outline" className="text-[10px]">
                              INACTIVE
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 break-words">
                          {userTeacherMeta(u)}
                        </div>
                      </div>

                      {isSelected ? <Badge className="text-[10px]">SELECTED</Badge> : null}
                    </button>
                  );
                })
              )}
            </div>

            {currentTeacherUserId &&
            effectiveTeacherId &&
            effectiveTeacherId !== currentTeacherUserId ? (
              <div className="text-xs text-muted-foreground">
                You’re changing the current assignment.
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t pt-4 mt-4">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Close
            </Button>

            <Button
              onClick={onAssign}
              disabled={busy || !effectiveTeacherId || effectiveTeacherId === currentTeacherUserId}
            >
              {assignMut.isPending
                ? "Saving…"
                : currentTeacherUserId
                ? "Update teacher"
                : "Assign teacher"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
