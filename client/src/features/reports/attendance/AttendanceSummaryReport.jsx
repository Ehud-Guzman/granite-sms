import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { attendanceClassSummary, exportAttendanceClassSummary } from "@/api/attendance.api";
import { printSection } from "@/lib/print";
import { normalizeArray, fmtClass, fmtNumber } from "../utils/format";
import { getErrorMessage as errMsg } from "@/lib/errors";

import PrintDocument from "@/components/print/PrintDocument";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import AttendanceNav from "./AttendanceNav";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function AttendanceSummaryReport() {
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());

  const { data: classesRaw, isLoading: classesLoading } = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => listClasses({ active: true }),
  });

  const classes = useMemo(() => normalizeArray(classesRaw), [classesRaw]);

  const selectedClass = useMemo(
    () => classes.find((c) => String(c.id) === String(classId)) || null,
    [classes, classId]
  );

  const params = useMemo(() => {
    if (!classId || !from || !to) return null;
    return { from, to };
  }, [classId, from, to]);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["attendanceReports", "summary", classId, params],
    queryFn: () => attendanceClassSummary(classId, params),
    enabled: Boolean(classId && params),
  });

  const days = useMemo(() => (Array.isArray(report?.days) ? report.days : []), [report]);

  const overallRate = useMemo(() => {
    if (!days.length) return 0;
    const totalPresent = days.reduce((s, d) => s + Number(d.present || 0), 0);
    const total = days.reduce((s, d) => s + Number(d.total || 0), 0);
    return total ? (totalPresent / total) * 100 : 0;
  }, [days]);

  const printSubtitle = `${selectedClass ? fmtClass(selectedClass) : classId ? `Class ${classId}` : "-"} • ${from} to ${to}`;

  const [exporting, setExporting] = useState(false);
  const doExport = async (format) => {
    if (!classId || !params) return;
    setExporting(true);
    try {
      await exportAttendanceClassSummary(classId, params, format);
    } catch (err) {
      console.error("EXPORT ATTENDANCE SUMMARY ERROR:", err);
      alert("Export failed. Check your network and try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Attendance — Class Summary</h2>
          <p className="opacity-70 mt-1">Daily attendance rate for a class over a date range.</p>
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
            onClick={() => printSection("print-attendance-summary")}
            disabled={!report}
          >
            Print
          </Button>
        </div>
      </div>

      <AttendanceNav />

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Class</div>
            <Select value={String(classId)} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue placeholder={classesLoading ? "Loading classes..." : "Select class"} />
              </SelectTrigger>
              <SelectContent>
                {classes.length === 0 ? (
                  <div className="px-3 py-2 text-sm opacity-70">No active classes found.</div>
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

          <div className="space-y-1">
            <div className="text-xs opacity-70">From</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">To</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}
      {error && (
        <div className="text-red-600 no-print">
          {errMsg(error, "Failed to load report")}
        </div>
      )}

      <PrintDocument id="print-attendance-summary" className="space-y-3 bg-white">
        <ReportPrintTitle title="Attendance Summary Report" subtitle={printSubtitle} />

        {!report ? (
          !isLoading && !error ? (
            <div className="p-6 text-sm opacity-70">Select a class and range to view summary details.</div>
          ) : null
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs opacity-70">Overall Attendance Rate</div>
                  <div className="text-2xl font-semibold">{fmtNumber(overallRate, 1)}%</div>
                </div>
                <div>
                  <div className="text-xs opacity-70">Days Recorded</div>
                  <div className="text-2xl font-semibold">{days.length}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By Day</CardTitle>
              </CardHeader>
              <CardContent className="overflow-auto">
                {days.length === 0 ? (
                  <div className="text-sm opacity-70">No sessions in this range.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left opacity-70">
                      <tr>
                        <th className="py-2">Date</th>
                        <th className="text-right">Present</th>
                        <th className="text-right">Absent</th>
                        <th className="text-right">Late</th>
                        <th className="text-right">Excused</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Rate %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="py-2">{String(d.date).slice(0, 10)}</td>
                          <td className="text-right">{d.present}</td>
                          <td className="text-right">{d.absent}</td>
                          <td className="text-right">{d.late}</td>
                          <td className="text-right">{d.excused}</td>
                          <td className="text-right">{d.total}</td>
                          <td className="text-right">{fmtNumber(d.attendanceRatePct, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <ReportPrintFooter />
              </CardContent>
            </Card>
          </>
        )}
      </PrintDocument>

      <div className="no-print">
        <Button asChild variant="outline">
          <Link to="/app/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
