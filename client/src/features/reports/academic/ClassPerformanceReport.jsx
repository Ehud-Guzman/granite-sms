// src/features/reports/academic/ClassPerformanceReport.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listExamSessions } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { exportClassPerformanceReport } from "@/api/reports.api";
import { useClassPerformanceReport } from "../hooks/useClassPerformanceReport";
import { printSection } from "@/lib/print";
import { normalizeArray, fmtClass, fmtNumber } from "../utils/format";

import PrintDocument from "@/components/print/PrintDocument";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function RankingTable({ ranking, sticky }) {
  return (
    <table className="w-full text-sm">
      <thead className={`text-left opacity-70 border-b ${sticky ? "sticky top-0 bg-white" : ""}`}>
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
        {ranking.map((r) => (
          <tr key={r.studentId} className={`border-t ${sticky ? "hover:bg-gray-50" : ""}`}>
            <td className="py-2">{r.position}</td>
            <td>{r.admissionNo}</td>
            <td>{r.name}</td>
            <td className="text-right">{fmtNumber(r.average ?? 0, 2)}</td>
            <td className="text-right">{fmtNumber(r.total ?? 0)}</td>
            <td className="text-right">{r.grade || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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

  const ranking = report?.ranking || [];
  const showHint =
    !classId || !sessionId || (!report && !isLoading && !error);

  const [exporting, setExporting] = useState(false);
  const doExport = async (format) => {
    if (!sessionId || !report) return;
    setExporting(true);
    try {
      await exportClassPerformanceReport(sessionId, format);
    } catch (err) {
      console.error("EXPORT CLASS PERFORMANCE ERROR:", err);
      alert("Export failed. Check your network and try again.");
    } finally {
      setExporting(false);
    }
  };

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
          <Button variant="outline" onClick={() => doExport("csv")} disabled={!report || exporting}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => doExport("xlsx")} disabled={!report || exporting}>
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => printSection("print-class-performance")}
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
          <ReportPrintTitle title="Class Performance Report" subtitle={printSubtitle} />

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
                <RankingTable ranking={ranking} sticky />
              </div>

              {/* Print version (no sticky header/hover — irrelevant on paper) */}
              <div className="hidden print:block">
                <RankingTable ranking={ranking} />
              </div>

              <ReportPrintFooter />
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
