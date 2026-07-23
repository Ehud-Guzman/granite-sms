import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { attendanceDefaulters, exportAttendanceDefaulters } from "@/api/attendance.api";
import { printSection } from "@/lib/print";
import { normalizeArray, fmtClass } from "../utils/format";
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

export default function AttendanceDefaultersReport() {
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [minAbsences, setMinAbsences] = useState("5");

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
    if (!classId) return null;
    return {
      classId: String(classId),
      from,
      to,
      minAbsences: Number(minAbsences || 5),
    };
  }, [classId, from, to, minAbsences]);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["attendanceReports", "defaulters", params],
    queryFn: () => attendanceDefaulters(params),
    enabled: Boolean(params),
  });

  const rows = useMemo(() => (Array.isArray(report) ? report : []), [report]);

  const printSubtitle = `${
    selectedClass ? fmtClass(selectedClass) : `Class ${String(classId)}`
  } • ${from} to ${to} • Min Absences: ${minAbsences}`;

  const [exporting, setExporting] = useState(false);
  const doExport = async (format) => {
    if (!params) return;
    setExporting(true);
    try {
      await exportAttendanceDefaulters(params, format);
    } catch (err) {
      console.error("EXPORT ATTENDANCE DEFAULTERS ERROR:", err);
      alert("Export failed. Check your network and try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Attendance — Defaulters</h2>
          <p className="opacity-70 mt-1">Students at or above a minimum absence count.</p>
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
            onClick={() => printSection("print-attendance-defaulters")}
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

        <CardContent className="grid gap-3 md:grid-cols-4">
          <Select value={String(classId || "")} onValueChange={setClassId}>
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

          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />

          <Input
            type="number"
            value={minAbsences}
            onChange={(e) => setMinAbsences(e.target.value)}
            placeholder="Min absences"
          />
        </CardContent>
      </Card>

      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}
      {error && (
        <div className="text-red-600 no-print">
          {errMsg(error, "Failed to load report")}
        </div>
      )}

      {report && (
        <PrintDocument id="print-attendance-defaulters" className="space-y-3 bg-white">
          <ReportPrintTitle title="Attendance Defaulters Report" subtitle={printSubtitle} />

          <Card>
            <CardHeader>
              <CardTitle>Defaulters ({rows.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              {rows.length === 0 ? (
                <div className="text-sm opacity-70">No defaulters for these filters.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left opacity-70">
                    <tr>
                      <th className="py-2">#</th>
                      <th>Adm</th>
                      <th>Student</th>
                      <th className="text-right">Absences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={r.studentId} className="border-t">
                        <td className="py-2">{idx + 1}</td>
                        <td>{r.admissionNo || "-"}</td>
                        <td>{r.name}</td>
                        <td className="text-right">{r.absences}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <ReportPrintFooter />
            </CardContent>
          </Card>

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
