// src/features/reports/academic/ClassPerformanceReport.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listExamSessions } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { useClassPerformanceReport } from "../hooks/useClassPerformanceReport";
import { printId } from "../utils/print";

import PrintDocument from "@/components/print/PrintDocument";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function fmtClass(c) {
  return `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})`;
}

function normalizeArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (Array.isArray(maybe?.data)) return maybe.data;
  if (Array.isArray(maybe?.sessions)) return maybe.sessions;
  if (Array.isArray(maybe?.data?.data)) return maybe.data.data;
  return [];
}

function fmtNumber(n, dp = 0) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return dp ? "0.00" : "0";
  return dp > 0 ? v.toFixed(dp) : v.toLocaleString();
}

function fmtDateTime(d = new Date()) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
}

export default function ClassPerformanceReport() {
  const [classId, setClassId] = useState("");
  const [sessionId, setSessionId] = useState("");

  // Classes
  const { data: classesRaw, isLoading: classesLoading } = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => listClasses({ active: true }),
  });

  const classes = useMemo(() => normalizeArray(classesRaw), [classesRaw]);

  // Sessions (published only)
  const { data: sessionsRaw, isLoading: sessionsLoading } = useQuery({
    queryKey: ["examSessions", "published", classId],
    queryFn: () =>
      listExamSessions({ classId: String(classId), status: "PUBLISHED" }),
    enabled: Boolean(classId),
  });

  const sessions = useMemo(() => normalizeArray(sessionsRaw), [sessionsRaw]);

  // Report
  const { data: reportRaw, isLoading, error } = useClassPerformanceReport({
    sessionId,
  });

  const report = reportRaw?.data;

  const selectedClass = useMemo(
    () => classes.find((c) => String(c.id) === String(classId)) || null,
    [classes, classId]
  );

  const selectedSession = useMemo(
    () => sessions.find((s) => String(s.id) === String(sessionId)) || null,
    [sessions, sessionId]
  );

  const printSubtitle = useMemo(() => {
    const c = selectedClass ? fmtClass(selectedClass) : "—";
    const s = selectedSession
      ? `${selectedSession.name || "Session"} • ${selectedSession.term} ${selectedSession.year}`
      : "—";
    return `${c} • ${s}`;
  }, [selectedClass, selectedSession]);

  const showHint =
    !classId || !sessionId || (!report && !isLoading && !error);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Academic — Class Performance</h2>
          <p className="opacity-70 mt-1">
            Read-only summary + ranking for a{" "}
            <span className="font-medium">PUBLISHED</span> exam session.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => printId("print-class-performance")}
            disabled={!report}
            title={!report ? "Load a report first" : "Print this report"}
          >
            Print
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="no-print">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-2">
          {/* Class */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Class</div>

            <Select
              value={String(classId || "")}
              onValueChange={(v) => {
                setClassId(v);
                setSessionId("");
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    classesLoading ? "Loading classes..." : "Select class"
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {classes.length === 0 ? (
                  <div className="px-3 py-2 text-sm opacity-70">
                    No active classes found.
                  </div>
                ) : (
                  classes.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {fmtClass(c)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Session */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Published Exam Session</div>

            <Select
              value={String(sessionId || "")}
              onValueChange={(v) => setSessionId(v)}
              disabled={!classId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !classId
                      ? "Select class first"
                      : sessionsLoading
                      ? "Loading sessions..."
                      : "Select session"
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {!classId ? (
                  <div className="px-3 py-2 text-sm opacity-70">
                    Select a class first.
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="px-3 py-2 text-sm opacity-70">
                    No <span className="font-medium">PUBLISHED</span> sessions
                    for{" "}
                    <span className="font-medium">
                      {selectedClass ? fmtClass(selectedClass) : "this class"}
                    </span>
                    .
                  </div>
                ) : (
                  sessions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {(s.name || "Session")} • {s.term} {s.year}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {classId && sessions.length === 0 && !sessionsLoading && (
              <div className="text-xs opacity-70">
                Tip: sessions only show after you{" "}
                <span className="font-medium">publish</span> results.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Guidance */}
      {showHint && (
        <div className="no-print text-sm opacity-70">
          Select a <span className="font-medium">Class</span> and a{" "}
          <span className="font-medium">Published Session</span> to view the report.
        </div>
      )}

      {/* States */}
      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}

      {error && (
        <div className="text-red-600 no-print">
          {String(error?.message || "Failed to load report")}
        </div>
      )}

      {/* Report */}
      {report && (
        <PrintDocument id="print-class-performance" className="space-y-3 bg-white">
          {/* optional: report title/subtitle for print-only */}
          <div className="hidden print:block">
            <div className="text-base font-semibold">Class Performance Report</div>
            <div className="text-sm opacity-70">{printSubtitle}</div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs opacity-70">Class</div>
                <div className="font-medium">
                  {report.class?.name}
                  {report.class?.stream ? ` ${report.class.stream}` : ""} (
                  {report.class?.year})
                </div>
              </div>

              <div>
                <div className="text-xs opacity-70">Session</div>
                <div className="font-medium">
                  {report.session?.name || "Session"} • {report.session?.term}{" "}
                  {report.session?.year}
                </div>
              </div>

              <div>
                <div className="text-xs opacity-70">Students</div>
                <div className="font-medium">
                  {fmtNumber(report.stats?.studentCount ?? 0)}
                </div>
              </div>

              <div>
                <div className="text-xs opacity-70">Class Mean</div>
                <div className="font-medium">
                  {fmtNumber(report.stats?.classMean ?? 0, 2)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grade Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(report.stats?.gradeDistribution || []).length === 0 ? (
                <div className="text-sm opacity-70">
                  No grade distribution available.
                </div>
              ) : (
                report.stats.gradeDistribution.map((g) => (
                  <div
                    key={g.grade}
                    className="border rounded-full px-3 py-1 text-sm"
                  >
                    <span className="font-medium">{g.grade}</span>
                    <span className="opacity-70"> • {fmtNumber(g.count)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ranking</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <div className="max-h-[520px] overflow-auto no-print">
                <table className="w-full text-sm">
                  <thead className="text-left opacity-70 sticky top-0 bg-white border-b">
                    <tr>
                      <th className="py-2">Pos</th>
                      <th>Adm</th>
                      <th>Student</th>
                      <th className="text-right">Avg</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.ranking || []).map((r) => (
                      <tr key={r.studentId} className="border-t hover:bg-gray-50">
                        <td className="py-2">{r.position}</td>
                        <td>{r.admissionNo}</td>
                        <td>{r.name}</td>
                        <td className="text-right">
                          {fmtNumber(r.average ?? 0, 2)}
                        </td>
                        <td className="text-right">{fmtNumber(r.total ?? 0)}</td>
                        <td className="text-right">{r.grade || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Print table (no sticky header) */}
              <div className="hidden print:block">
                <table className="w-full text-sm">
                  <thead className="text-left opacity-70">
                    <tr>
                      <th className="py-2">Pos</th>
                      <th>Adm</th>
                      <th>Student</th>
                      <th className="text-right">Avg</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.ranking || []).map((r) => (
                      <tr key={r.studentId} className="border-t">
                        <td className="py-2">{r.position}</td>
                        <td>{r.admissionNo}</td>
                        <td>{r.name}</td>
                        <td className="text-right">
                          {fmtNumber(r.average ?? 0, 2)}
                        </td>
                        <td className="text-right">{fmtNumber(r.total ?? 0)}</td>
                        <td className="text-right">{r.grade || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* keep this local meta block for now */}
              <div className="mt-4 text-xs opacity-70">
                Printed: {fmtDateTime()}
              </div>
              <div className="mt-6 flex justify-between text-xs">
                <div>Signature: ____________________</div>
                <div>Date: ____________________</div>
              </div>
            </CardContent>
          </Card>

          {/* Screen-only */}
          <div className="no-print">
            <Button asChild variant="outline">
              <Link to="/app/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </PrintDocument>
      )}
    </div>
  );
}
