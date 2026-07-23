import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { getFeesDefaulters, exportFeesDefaulters } from "@/api/feesReports.api";
import { printSection } from "@/lib/print";
import { normalizeArray, fmtClass, fmtMoney, fmtStudentName } from "../utils/format";
import { getErrorMessage as errMsg } from "@/lib/errors";

import PrintDocument from "@/components/print/PrintDocument";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import FinanceNav from "./FinanceNav";

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

const TERMS = ["TERM1", "TERM2", "TERM3"];

export default function FeesDefaultersReport() {
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState("TERM1");
  const [minBalance, setMinBalance] = useState("1");
  const [limit, setLimit] = useState("50");

  // Classes
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
    if (!classId || !year || !term) return null;
    return {
      classId: String(classId),
      year: Number(year),
      term: String(term),
      minBalance: Number(minBalance || 1),
      limit: Number(limit || 50),
    };
  }, [classId, year, term, minBalance, limit]);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["feesReports", "defaulters", params],
    queryFn: () => getFeesDefaulters(params),
    enabled: Boolean(params),
  });

  const printSubtitle = `${
    selectedClass ? fmtClass(selectedClass) : `Class ${String(classId)}`
  } • ${term} ${year} • Min Balance: ${minBalance}`;

  const [exporting, setExporting] = useState(false);
  const doExport = async (format) => {
    if (!params) return;
    setExporting(true);
    try {
      await exportFeesDefaulters(params, format);
    } catch (err) {
      console.error("EXPORT FEES DEFAULTERS ERROR:", err);
      alert("Export failed. Check your network and try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* top bar */}
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Finance — Fees Defaulters</h2>
          <p className="opacity-70 mt-1">
            Print-first list sorted by highest balance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => doExport("csv")}
            disabled={!report || exporting}
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => doExport("xlsx")}
            disabled={!report || exporting}
          >
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => printSection("print-fees-defaulters")}
            disabled={!report}
            title={!report ? "Load a report first" : "Print this report"}
          >
            Print
          </Button>
        </div>
      </div>

      <FinanceNav />

      {/* filters */}
      <Card className="no-print">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1 md:col-span-2">
            <div className="text-xs opacity-70">Class</div>
            <Select value={String(classId || "")} onValueChange={setClassId}>
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

          <div className="space-y-1">
            <div className="text-xs opacity-70">Year</div>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Term</div>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger>
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                {TERMS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Min Balance</div>
            <Input
              value={minBalance}
              onChange={(e) => setMinBalance(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Limit</div>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}
      {error && (
        <div className="text-red-600 no-print">
          {errMsg(error, "Failed to load report")}
        </div>
      )}

      {report && (
        <PrintDocument
          id="print-fees-defaulters"
          className="space-y-3 bg-white"
        >
          <ReportPrintTitle title="Fees Defaulters Report" subtitle={printSubtitle} />

          <Card>
            <CardHeader>
              <CardTitle>
                Defaulters ({Number(report.count ?? 0).toLocaleString()})
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="py-2">#</th>
                    <th>Adm</th>
                    <th>Student</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.rows || []).map((r, idx) => (
                    <tr key={r.invoiceId} className="border-t">
                      <td className="py-2">{idx + 1}</td>
                      <td>{r.student?.admissionNo || "-"}</td>
                      <td>{fmtStudentName(r.student)}</td>
                      <td className="text-right">{fmtMoney(r.balance)}</td>
                      <td className="text-right">{fmtMoney(r.paid)}</td>
                      <td className="text-right">{fmtMoney(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

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
