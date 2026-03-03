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
  return Number(n || 0).toLocaleString();
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

  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["feesReports", "classSummary", params],
    queryFn: () => getFeesClassSummary(params),
    enabled: Boolean(params),
  });

  const collectionPct = useMemo(() => {
    const billed = Number(report?.totalBilled || 0);
    const paid = Number(report?.totalPaid || 0);
    return billed ? (paid / billed) * 100 : 0;
  }, [report]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Finance — Fees Summary</h2>
          <p className="opacity-70 mt-1">
            Class-level billing vs payments (read-only).
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() => printId("print-fees-summary")}
          disabled={!report}
        >
          Print
        </Button>
      </div>

      <FinanceNav />

      {/* Filters */}
      <Card className="no-print">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-3">
          {/* Class */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Class</div>
            <Select value={String(classId)} onValueChange={setClassId}>
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

          {/* Year */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Year</div>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
            />
          </div>

          {/* Term */}
          <div className="space-y-1">
            <div className="text-xs opacity-70">Term</div>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger>
                <SelectValue />
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

      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}
      {error && (
        <div className="text-red-600 no-print">
          {String(error?.message || "Failed to load report")}
        </div>
      )}

      {/* PRINT BLOCK — ALWAYS MOUNTED */}
      <PrintDocument id="print-fees-summary" className="space-y-3 bg-white">
        {/* Print-only heading */}
        <div className="hidden print:block">
          <div className="text-base font-semibold">Fees Summary Report</div>
          <div className="text-sm opacity-70">
            {selectedClass
              ? fmtClass(selectedClass)
              : classId
              ? `Class ${classId}`
              : "-"}{" "}
            • {term} {year}
          </div>
        </div>

        {!report ? (
          <div className="p-6 text-sm opacity-70">
            Load a report to view summary details.
          </div>
        ) : (
          <>
            {/* Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>

              <CardContent className="grid gap-3 md:grid-cols-5">
                <Metric label="Total Billed" value={fmtMoney(report.totalBilled)} />
                <Metric label="Total Paid" value={fmtMoney(report.totalPaid)} />
                <Metric label="Total Balance" value={fmtMoney(report.totalBalance)} />
                <Metric label="Collection %" value={`${collectionPct.toFixed(2)}%`} />
                <Metric
                  label="Invoices"
                  value={Number(report.invoiceCount ?? 0).toLocaleString()}
                />
              </CardContent>
            </Card>

            {/* Status Counts */}
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

            {/* Footer */}
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
          </>
        )}
      </PrintDocument>

      {/* Back Button */}
      <div className="no-print">
        <Button asChild variant="outline">
          <Link to="/app/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-xs opacity-70">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}