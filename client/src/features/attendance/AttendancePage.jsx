// src/features/attendance/AttendancePage.jsx
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import {
  createOrOpenAttendanceSession,
  listAttendanceSessions,
} from "@/api/attendance.api";
import { useMe } from "@/hooks/useMe";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function fmtClass(c) {
  return `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})`;
}

function normalizeSessions(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.sessions)) return raw.sessions;
  return [];
}

// keep status mapping consistent with backend enums
function normalizeStatus(s) {
  const st = String(s?.status || s?.state || "DRAFT").toUpperCase();
  if (st === "OPEN") return "DRAFT"; // if older frontend uses OPEN
  return st;
}

function badgeVariant(st) {
  if (st === "LOCKED") return "destructive";
  if (st === "SUBMITTED") return "secondary";
  return "outline"; // DRAFT/OPEN/etc
}

function safeDateLabel(v) {
  if (!v) return "—";
  // supports ISO string or Date-like
  return String(v).slice(0, 10);
}

export default function AttendancePage() {
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: meData, isLoading: meLoading } = useMe();
  const role = meData?.role ?? meData?.user?.role;

  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [term, setTerm] = useState("TERM1"); // required by backend
  const [status, setStatus] = useState(""); // optional filter

  const year = useMemo(() => new Date(date).getFullYear(), [date]);

  const classesQ = useQuery({
    queryKey: ["classes", { year: null }],
    queryFn: () => listClasses({}),
    retry: false,
    staleTime: 60 * 1000,
  });

  const classes = useMemo(
    () => (Array.isArray(classesQ.data) ? classesQ.data : []),
    [classesQ.data]
  );

  const selectedClass = useMemo(
    () => classes.find((c) => String(c.id) === String(classId)),
    [classes, classId]
  );

  const sessionsQ = useQuery({
    queryKey: ["attendanceSessions", { classId, date, term, status: status || null }],
    queryFn: () =>
      listAttendanceSessions({
        classId,
        date,
        term,
        status: status || undefined,
      }),
    enabled: !!classId,
    retry: false,
    staleTime: 10 * 1000,
  });

  const sessions = useMemo(() => normalizeSessions(sessionsQ.data), [sessionsQ.data]);

  const createMut = useMutation({
    mutationFn: createOrOpenAttendanceSession,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["attendanceSessions"] });
      if (data?.id) qc.invalidateQueries({ queryKey: ["attendanceSession", data.id] });
    },
  });

  const canCreate = !!classId && !!term && !createMut.isPending;

  const createErrorMsg =
    createMut.error?.response?.data?.message ||
    createMut.error?.message ||
    "Failed to create/open session.";

  const sessionsErrorMsg =
    sessionsQ.error?.response?.data?.message ||
    sessionsQ.error?.message ||
    "Server error";

  if (meLoading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {/* Back button */}
            <Button variant="outline" size="sm" onClick={() => nav(-1)}>
              ← Back
            </Button>

            <h1 className="text-2xl font-semibold">Attendance</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            Create/open a session, mark students, then submit. Admins can lock/unlock sessions.
          </p>
        </div>

        <Badge variant="secondary" className="uppercase text-[10px]">
          {role || "—"}
        </Badge>
      </div>

      {/* Session Setup */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Session setup</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            {/* Class */}
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={classesQ.isLoading}
            >
              <option value="">Select class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmtClass(c)}
                </option>
              ))}
            </select>

            {/* Date */}
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

            {/* Term */}
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              <option value="TERM1">Term 1</option>
              <option value="TERM2">Term 2</option>
              <option value="TERM3">Term 3</option>
            </select>

            {/* Status filter */}
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!classId}
              title={!classId ? "Select a class first" : ""}
            >
              <option value="">All statuses</option>
              {/* Match backend-ish values; keep OPEN for legacy filter input */}
              <option value="DRAFT">Open (Draft)</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="LOCKED">Locked</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedClass ? (
                <>
                  Selected:{" "}
                  <span className="font-medium text-foreground">
                    {fmtClass(selectedClass)}
                  </span>{" "}
                  • <span className="font-medium text-foreground">{term}</span> •{" "}
                  <span className="font-medium text-foreground">{year}</span>
                </>
              ) : (
                "Choose a class to view/create sessions."
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() =>
                  createMut.mutate({
                    classId,
                    date,
                    year,
                    term,
                  })
                }
                disabled={!canCreate}
              >
                {createMut.isPending ? "Creating…" : "Create / Open session"}
              </Button>

              <Button
                variant="outline"
                disabled={!classId || sessionsQ.isFetching}
                onClick={() => sessionsQ.refetch()}
              >
                {sessionsQ.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>

          {createMut.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {createErrorMsg}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sessions List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Sessions</span>
            {!!classId && (
              <span className="text-xs text-muted-foreground">
                {sessionsQ.isLoading ? "Loading…" : `${sessions.length} found`}
              </span>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          {!classId && (
            <div className="text-sm text-muted-foreground">Pick a class to view sessions.</div>
          )}

          {sessionsQ.isLoading && (
            <div className="text-sm text-muted-foreground">Loading sessions…</div>
          )}

          {sessionsQ.isError && (
            <div className="text-sm">
              <div className="font-medium">Failed to load sessions</div>
              <div className="text-muted-foreground mt-1">{sessionsErrorMsg}</div>
            </div>
          )}

          {!sessionsQ.isLoading && !sessionsQ.isError && classId && sessions.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No sessions found. Create one above.
            </div>
          )}

          {!sessionsQ.isLoading && !sessionsQ.isError && classId && sessions.length > 0 && (
            <div className="grid gap-2">
              {sessions.map((s) => {
                const st = normalizeStatus(s);
                const label =
                  s.title ||
                  s.name ||
                  (selectedClass ? fmtClass(selectedClass) : "Attendance session");

                const dateLabel = safeDateLabel(s.date || s.sessionDate || s.createdAt);

                return (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-md border bg-background p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        Date: {dateLabel} • Term: {s.term || term} • Year: {s.year || year}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2">
                      <Badge variant={badgeVariant(st)} className="text-[10px]">
                        {st === "DRAFT" ? "OPEN" : st}
                      </Badge>

                      <Button size="sm" asChild>
                        <Link to={`/app/attendance/${s.id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Separator />
          <div className="text-xs text-muted-foreground">
            Tip: “Create / Open session” reuses the same session for that class + date if it already
            exists.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
