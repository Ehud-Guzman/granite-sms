import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { getFeesClassSummary } from "@/api/feesReports.api";
import { printId } from "../utils/print";

import PrintDocument from "@/components/print/PrintDocument";

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

function normalizeArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (Array.isArray(maybe?.data)) return maybe.data;
  if (Array.isArray(maybe?.data?.data)) return maybe.data.data;
  return [];
}

function fmtClass(c) {
  return `${c.name}${c.stream ? ` ${c.stream}` : ""} (${c.year})`;
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString();
}

const TERMS = ["TERM1", "TERM2", "TERM3"];

function FinanceNav() {
  const linkCls = ({ isActive }) =>
    `px-3 py-2 rounded-md border text-sm ${
      isActive ? "bg-black text-white" : "bg-white"
    }`;

  return (
    <div className="flex gap-2 no-print flex-wrap">
      <NavLink className={linkCls} to="/app/reports/fees/summary" end>
        Summary
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/defaulters">
        Defaulters
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/collections">
        Collections
      </NavLink>
    </div>
  );
}

export default function FeesSummaryReport() {
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState("TERM1");

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
    return { classId: String(classId), year: Number(year), term: String(term) };
  }, [classId, year, term]);

  // Report
  const { data: report, isLoading, error } = useQuery({
    queryKey: ["feesReports", "classSummary", params],
    queryFn: () => getFeesClassSummary(params),
    enabled: Boolean(params),
  });

  const collectionPct = useMemo(() => {
    const billed = Number(report?.totalBilled || 0);
    const paid = Number(report?.totalPaid || 0);
    if (!billed) return 0;
    return (paid / billed) * 100;
  }, [report]);

  return (
    <div className="space-y-4">
      {/* top bar */}
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Finance — Fees Summary</h2>
          <p className="opacity-70 mt-1">
            Class-level billing vs payments (read-only).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => printId("print-fees-summary")}
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

        <CardContent className="grid gap-3 md:grid-cols-3">
          {/* class */}
          <div className="space-y-1">
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

          {/* year */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Year</div>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              placeholder="2026"
            />
          </div>

          {/* term */}
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
        </CardContent>
      </Card>

      {/* states */}
      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}
      {error && (
        <div className="text-red-600 no-print">
          {String(error?.message || "Failed to load report")}
        </div>
      )}

      {/* report */}
      {report && (
        <PrintDocument id="print-fees-summary" className="space-y-3 bg-white">
          {/* (No manual print header here — Letterhead handles it) */}

          {/* optional: report title/subtitle for print-only */}
          <div className="hidden print:block">
            <div className="text-base font-semibold">Fees Summary Report</div>
            <div className="text-sm opacity-70">
              {selectedClass
                ? fmtClass(selectedClass)
                : `Class ${String(classId)}`}{" "}
              • {term} {year}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>

            <CardContent className="grid gap-3 md:grid-cols-5">
              <div>
                <div className="text-xs opacity-70">Total Billed</div>
                <div className="font-medium">{fmtMoney(report.totalBilled)}</div>
              </div>

              <div>
                <div className="text-xs opacity-70">Total Paid</div>
                <div className="font-medium">{fmtMoney(report.totalPaid)}</div>
              </div>

              <div>
                <div className="text-xs opacity-70">Total Balance</div>
                <div className="font-medium">
                  {fmtMoney(report.totalBalance)}
                </div>
              </div>

              <div>
                <div className="text-xs opacity-70">Collection %</div>
                <div className="font-medium">{collectionPct.toFixed(2)}%</div>
              </div>

              <div>
                <div className="text-xs opacity-70">Invoices</div>
                <div className="font-medium">
                  {Number(report.invoiceCount ?? 0).toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice Status Counts</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.keys(report.statusCounts || {}).length === 0 ? (
                <div className="text-sm opacity-70">
                  No invoice statuses available.
                </div>
              ) : (
                Object.entries(report.statusCounts).map(([k, v]) => (
                  <div key={k} className="border rounded px-3 py-1 text-sm">
                    <span className="font-medium">{k}</span>
                    <span className="opacity-70">
                      {" "}
                      • {Number(v || 0).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="mt-4 text-xs opacity-70">
                Printed: {new Date().toLocaleString()}
              </div>
              <div className="mt-6 flex justify-between text-xs">
                <div>Signature: ____________________</div>
                <div>Date: ____________________</div>
              </div>
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
