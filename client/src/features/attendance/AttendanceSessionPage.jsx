// src/features/attendance/AttendanceSessionPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { listStudents } from "@/features/students/students.api";
import {
  getAttendanceSession,
  lockAttendanceSession,
  submitAttendanceSession,
  unlockAttendanceSession,
  updateAttendanceRecords,
} from "@/api/attendance.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function badgeVariant(status) {
  const s = String(status || "DRAFT").toUpperCase();
  if (s === "LOCKED") return "destructive";
  if (s === "SUBMITTED") return "secondary";
  return "outline";
}

export default function AttendanceSessionPage() {
  const { sessionId } = useParams();
  const qc = useQueryClient();

  const { data: meData, isLoading: meLoading } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  // 1) Session
  const sessionQ = useQuery({
    queryKey: ["attendanceSession", sessionId],
    queryFn: () => getAttendanceSession(sessionId),
    enabled: !!sessionId,
    retry: false,
    staleTime: 10 * 1000,
  });

  const session = sessionQ.data;
  const sessionStatus = String(session?.status || "DRAFT").toUpperCase();
  const isLocked = sessionStatus === "LOCKED";
  const isSubmitted = sessionStatus === "SUBMITTED";
  const disableEdits = isLocked || isSubmitted;

  // 2) Students
  const studentsQ = useQuery({
    queryKey: ["students", { classId: session?.classId }],
    queryFn: () => listStudents({ classId: session?.classId }),
    enabled: !!session?.classId,
    retry: false,
    staleTime: 30 * 1000,
  });

  const students = useMemo(
    () => (Array.isArray(studentsQ.data) ? studentsQ.data : []),
    [studentsQ.data]
  );

  const studentById = useMemo(() => {
    const m = new Map();
    for (const s of students) m.set(s.id, s);
    return m;
  }, [students]);

  // Local editable records
  const [search, setSearch] = useState("");
  const [local, setLocal] = useState([]); // [{ studentId, status, minutesLate, comment }]

  // Avoid StrictMode/dev double-effect + avoid "sync setState in effect" warning
  const initializedRef = useRef(false);

  // Reset local when session changes
  useEffect(() => {
    initializedRef.current = false;
    setLocal([]);
  }, [sessionId]);

  // Seed local ONCE when session + students ready
  useEffect(() => {
    if (!sessionId) return;
    if (!session) return;
    if (!studentsQ.isSuccess) return;
    if (initializedRef.current) return;

    const records = Array.isArray(session.records) ? session.records : [];
    const recordByStudentId = new Map();
    for (const r of records) recordByStudentId.set(r.studentId, r);

    const merged = students.map((stu) => {
      const r = recordByStudentId.get(stu.id);
      return {
        studentId: stu.id,
        status: String(r?.status || "PRESENT").toUpperCase(),
        minutesLate: r?.minutesLate ?? null,
        comment: r?.comment ?? "",
      };
    });

    // keep orphan records (rare)
    for (const r of records) {
      if (!students.some((s) => String(s.id) === String(r.studentId))) {
        merged.push({
          studentId: r.studentId,
          status: String(r?.status || "PRESENT").toUpperCase(),
          minutesLate: r?.minutesLate ?? null,
          comment: r?.comment ?? "",
        });
      }
    }

    // Defer to microtask to avoid warning about sync setState in effect
    Promise.resolve().then(() => {
      setLocal(merged);
      initializedRef.current = true;
    });
  }, [sessionId, session, studentsQ.isSuccess, students]);

  // Mutations
  const saveMut = useMutation({
    mutationFn: (records) => updateAttendanceRecords(sessionId, records),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendanceSession", sessionId] }),
  });

  const submitMut = useMutation({
    mutationFn: () => submitAttendanceSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendanceSession", sessionId] });
      qc.invalidateQueries({ queryKey: ["attendanceSessions"] });
    },
  });

  const lockMut = useMutation({
    mutationFn: () => lockAttendanceSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendanceSession", sessionId] }),
  });

  const unlockMut = useMutation({
    mutationFn: () => unlockAttendanceSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendanceSession", sessionId] }),
  });

  // Helpers
  const setStatus = (studentId, status) => {
    setLocal((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              status,
              minutesLate: status === "LATE" ? (r.minutesLate ?? 5) : null,
            }
          : r
      )
    );
  };

  const setMinutesLate = (studentId, minutesLate) => {
    const n = Number(minutesLate);
    setLocal((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, minutesLate: Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null }
          : r
      )
    );
  };

  const setComment = (studentId, comment) => {
    setLocal((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)));
  };

  const save = () => {
    const payload = local.map((r) => ({
      studentId: r.studentId,
      status: r.status,
      minutesLate: r.status === "LATE" ? (r.minutesLate ?? 0) : null,
      comment: r.comment?.trim() ? r.comment.trim() : null,
    }));
    saveMut.mutate(payload);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return local;

    return local.filter((r) => {
      const stu = studentById.get(r.studentId);
      const name = stu ? `${stu.firstName || ""} ${stu.lastName || ""}` : "";
      const adm = stu?.admissionNo || "";
      return `${name} ${adm}`.toLowerCase().includes(q);
    });
  }, [local, search, studentById]);

  const dateLabel = session?.date ? String(session.date).slice(0, 10) : "—";

  if (meLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">Attendance session</div>
          <h1 className="text-2xl font-semibold">Class Attendance</h1>
          <div className="text-xs text-muted-foreground mt-1">
            Date: <span className="font-medium text-foreground">{dateLabel}</span> • Term:{" "}
            <span className="font-medium text-foreground">{session?.term || "-"}</span> • Year:{" "}
            <span className="font-medium text-foreground">{session?.year || "-"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="uppercase text-[10px]">
            {role || "—"}
          </Badge>
          <Button variant="outline" asChild>
            <Link to="/app/attendance">Back</Link>
          </Button>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Controls</span>
            <Badge variant={badgeVariant(sessionStatus)} className="text-[10px]">
              {sessionStatus}
            </Badge>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <Input
              placeholder="Search student…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!local.length}
            />

            <div className="flex gap-2 flex-wrap">
              <Button onClick={save} disabled={!local.length || disableEdits || saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Save"}
              </Button>

              <Button
                variant="outline"
                onClick={() => submitMut.mutate()}
                disabled={!local.length || disableEdits || submitMut.isPending}
              >
                {submitMut.isPending ? "Submitting…" : "Submit"}
              </Button>

              {role === "ADMIN" && (
                <>
                  {!isLocked ? (
                    <Button
                      variant="destructive"
                      onClick={() => lockMut.mutate()}
                      disabled={lockMut.isPending}
                    >
                      Lock
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => unlockMut.mutate()}
                      disabled={unlockMut.isPending}
                    >
                      Unlock
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {(saveMut.isError || submitMut.isError || lockMut.isError || unlockMut.isError) && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {saveMut.error?.response?.data?.message ||
                submitMut.error?.response?.data?.message ||
                lockMut.error?.response?.data?.message ||
                unlockMut.error?.response?.data?.message ||
                "Action failed."}
            </div>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground">
            DRAFT editable • SUBMITTED frozen • LOCKED hard stop (admin can unlock).
          </div>
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Students</span>
            <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          {(sessionQ.isLoading || studentsQ.isLoading) && (
            <div className="text-sm text-muted-foreground">Loading session…</div>
          )}

          {(sessionQ.isError || studentsQ.isError) && (
            <div className="text-sm">
              <div className="font-medium">Failed to load data</div>
              <div className="text-muted-foreground mt-1">
                {sessionQ.error?.response?.data?.message ||
                  studentsQ.error?.response?.data?.message ||
                  "Server error"}
              </div>
            </div>
          )}

          {!sessionQ.isLoading &&
            !studentsQ.isLoading &&
            !sessionQ.isError &&
            !studentsQ.isError && (
              <>
                {filtered.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No students found.</div>
                ) : (
                  <div className="grid gap-2">
                    {filtered.map((r) => {
                      const stu = studentById.get(r.studentId);
                      const fullName = stu
                        ? `${stu.firstName || ""} ${stu.lastName || ""}`.trim()
                        : `Student (${String(r.studentId).slice(0, 6)}…)`;

                      return (
                        <div
                          key={r.studentId}
                          className="rounded-md border bg-background p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium">{fullName}</div>
                              <div className="text-xs text-muted-foreground">
                                Adm: {stu?.admissionNo || "-"}
                              </div>
                            </div>

                            <Badge variant="outline" className="text-[10px]">
                              {r.status}
                            </Badge>
                          </div>

                          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
                            <div className="flex gap-2 flex-wrap">
                              <Button
                                size="sm"
                                variant={r.status === "PRESENT" ? "default" : "outline"}
                                onClick={() => setStatus(r.studentId, "PRESENT")}
                                disabled={disableEdits}
                              >
                                Present
                              </Button>
                              <Button
                                size="sm"
                                variant={r.status === "ABSENT" ? "default" : "outline"}
                                onClick={() => setStatus(r.studentId, "ABSENT")}
                                disabled={disableEdits}
                              >
                                Absent
                              </Button>
                              <Button
                                size="sm"
                                variant={r.status === "LATE" ? "default" : "outline"}
                                onClick={() => setStatus(r.studentId, "LATE")}
                                disabled={disableEdits}
                              >
                                Late
                              </Button>
                            </div>

                            <div className="flex gap-2 items-center">
                              <Input
                                className="w-28"
                                type="number"
                                placeholder="mins late"
                                value={r.minutesLate ?? ""}
                                onChange={(e) => setMinutesLate(r.studentId, e.target.value)}
                                disabled={r.status !== "LATE" || disableEdits}
                              />
                              <Input
                                className="w-56"
                                placeholder="Comment (optional)"
                                value={r.comment || ""}
                                onChange={(e) => setComment(r.studentId, e.target.value)}
                                disabled={disableEdits}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
