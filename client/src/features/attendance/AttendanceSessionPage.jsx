// src/features/attendance/AttendanceSessionPage.jsx
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { getErrorMessage } from "@/lib/errors";
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
import { useSchoolCalendar } from "@/lib/schoolCalendar";

const STATUSES = [
  ["PRESENT", "Present", "bg-emerald-600 text-white shadow-sm"],
  ["ABSENT", "Absent", "bg-red-600 text-white shadow-sm"],
  ["LATE", "Late", "bg-amber-500 text-white shadow-sm"],
  ["EXCUSED", "Excused", "bg-slate-500 text-white shadow-sm"],
];

function badgeVariant(status) {
  const s = String(status || "DRAFT").toUpperCase();
  if (s === "LOCKED") return "destructive";
  if (s === "SUBMITTED") return "secondary";
  return "outline";
}

export default function AttendanceSessionPage() {
  const { termLabels } = useSchoolCalendar();
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

  // Tracks whether `local` has edits that haven't been persisted via Save.
  // "Submit" only flips the session's status server-side — it does NOT send
  // `local`, so submitting while dirty would lock in whatever was last
  // *saved*, silently discarding on-screen edits the user thinks they just
  // submitted. Gate the Submit button on this instead.
  const [dirty, setDirty] = useState(false);

  // Seed `local` from session + students exactly once per session, adjusting
  // state during render instead of in an effect (no extra commit/paint
  // cycle, no need for a "have I seeded yet" ref-guarded effect).
  const [seededSessionId, setSeededSessionId] = useState(null);
  const canSeed = !!sessionId && !!session && studentsQ.isSuccess;

  if (seededSessionId !== sessionId) {
    if (canSeed) {
      setSeededSessionId(sessionId);

      const records = Array.isArray(session.records) ? session.records : [];
      const recordByStudentId = new Map();
      for (const r of records) recordByStudentId.set(r.studentId, r);

      const merged = students.map((stu) => {
        const r = recordByStudentId.get(stu.id);
        return {
          studentId: stu.id,
          status: String(r?.status || "UNMARKED").toUpperCase(),
          minutesLate: r?.minutesLate ?? null,
          comment: r?.comment ?? "",
        };
      });

      // keep orphan records (rare)
      for (const r of records) {
        if (!students.some((s) => String(s.id) === String(r.studentId))) {
          merged.push({
            studentId: r.studentId,
            status: String(r?.status || "UNMARKED").toUpperCase(),
            minutesLate: r?.minutesLate ?? null,
            comment: r?.comment ?? "",
          });
        }
      }

      setLocal(merged);
      setDirty(false);
    } else if (local.length > 0) {
      // Session changed but the new session's data isn't ready yet —
      // clear stale rows from the previous session rather than show them.
      setLocal([]);
    }
  }

  // Mutations
  const saveMut = useMutation({
    mutationFn: (records) => updateAttendanceRecords(sessionId, records),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["attendanceSession", sessionId] });
    },
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
    setDirty(true);
  };

  const setMinutesLate = (studentId, minutesLate) => {
    const n = Number(minutesLate);
    // Clamp to the backend's allowed range (0-600) so a typo can't produce a
    // save the server will just reject with a 400.
    setLocal((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, minutesLate: Number.isFinite(n) ? Math.min(600, Math.max(0, Math.trunc(n))) : null }
          : r
      )
    );
    setDirty(true);
  };

  const setComment = (studentId, comment) => {
    setLocal((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)));
    setDirty(true);
  };

  // Learners not marked yet (the register starts this way; a register can't
  // be submitted until everyone has a status).
  const unmarkedCount = local.filter((r) => r.status === "UNMARKED").length;

  const markRestPresent = () => {
    setLocal((prev) => prev.map((r) => (r.status === "UNMARKED" ? { ...r, status: "PRESENT", minutesLate: null } : r)));
    setDirty(true);
  };

  const save = () => {
    // Unmarked rows stay unmarked on the server; only real statuses are sent.
    const payload = local.filter((r) => r.status !== "UNMARKED").map((r) => ({
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

  // The register's date is stored as a calendar day (midnight UTC): "Friday, 13 Nov".
  const dateLabel = session?.date
    ? new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(session.date))
    : "—";

  if (meLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Register</div>
          <h1 className="text-2xl font-semibold">{session?.class ? `${session.class.name}${session.class.stream ? ` ${session.class.stream}` : ""}` : "Class register"}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {dateLabel} · {termLabels?.[session?.term] || session?.term || "-"} {session?.year || ""}
          </div>
        </div>

        <div className="flex items-center gap-2">
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
              {unmarkedCount > 0 && !disableEdits && (
                <Button variant="outline" onClick={markRestPresent}>
                  Mark remaining {unmarkedCount} present
                </Button>
              )}

              <Button onClick={save} disabled={!local.length || disableEdits || saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Save"}
              </Button>

              <Button
                variant="outline"
                onClick={() => submitMut.mutate()}
                disabled={!local.length || disableEdits || submitMut.isPending || dirty || unmarkedCount > 0}
                title={
                  unmarkedCount > 0
                    ? `${unmarkedCount} learner(s) not marked yet`
                    : dirty
                      ? "Save your changes before submitting"
                      : undefined
                }
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
              {getErrorMessage(
                saveMut.error || submitMut.error || lockMut.error || unlockMut.error,
                "Action failed."
              )}
            </div>
          )}

          {dirty && !disableEdits && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              You have unsaved changes. Click <b>Save</b> before submitting — Submit locks in the
              last saved records, not what&apos;s on screen.
            </div>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground">
            A draft can be changed. Once submitted it is final; only an admin can unlock it.
          </div>
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Learners</span>
            <span className="flex items-center gap-2">
              {!disableEdits && unmarkedCount > 0 && (
                <Button size="sm" variant="outline" onClick={() => local.filter((x) => x.status === "UNMARKED").forEach((x) => setStatus(x.studentId, "PRESENT"))}>
                  Mark the rest present
                </Button>
              )}
              <span className="text-xs font-normal text-muted-foreground">{filtered.length} shown</span>
            </span>
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
                {getErrorMessage(sessionQ.error || studentsQ.error, "Server error")}
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
                          className={`rounded-lg border p-3 space-y-2 ${r.status === "UNMARKED" ? "border-amber-400 bg-amber-50/60 dark:bg-amber-900/10" : "bg-background"}`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0">
                              <span className="font-medium">{fullName}</span>{" "}
                              <span className="text-xs text-muted-foreground">{stu?.admissionNo || ""}</span>
                            </div>
                            {r.status === "UNMARKED" && <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">Not marked</span>}
                          </div>

                          {/* One tap per learner; the chosen status is filled in its colour. */}
                          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1" role="radiogroup" aria-label={`Attendance for ${fullName}`}>
                            {STATUSES.map(([value, label, on]) => (
                              <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={r.status === value}
                                onClick={() => setStatus(r.studentId, value)}
                                disabled={disableEdits}
                                className={`rounded-md px-1 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${r.status === value ? on : "text-muted-foreground hover:bg-background"}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          {(r.status !== "PRESENT" && r.status !== "UNMARKED") || r.comment ? (
                            <div className="flex gap-2">
                              {r.status === "LATE" && (
                                <Input
                                  className="w-28 shrink-0"
                                  type="number"
                                  min={0}
                                  max={600}
                                  placeholder="Mins late"
                                  value={r.minutesLate ?? ""}
                                  onChange={(e) => setMinutesLate(r.studentId, e.target.value)}
                                  disabled={disableEdits}
                                />
                              )}
                              <Input
                                className="min-w-0 flex-1"
                                placeholder={r.status === "ABSENT" ? "Reason, if known (optional)" : "Note (optional)"}
                                value={r.comment || ""}
                                onChange={(e) => setComment(r.studentId, e.target.value)}
                                disabled={disableEdits}
                                maxLength={250}
                              />
                            </div>
                          ) : null}
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
