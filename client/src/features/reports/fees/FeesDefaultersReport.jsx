import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { getFeesDefaulters } from "@/api/feesReports.api";
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

function fmtName(s) {
  const first = s?.firstName || "";
  const last = s?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

function FinanceNav() {
  const linkCls = ({ isActive }) =>
    `px-3 py-2 rounded-md border text-sm ${
      isActive ? "bg-black text-white" : "bg-white"
    }`;

  return (
    <div className="flex gap-2 no-print flex-wrap">
      <NavLink className={linkCls} to="/app/reports/fees/summary">
        Summary
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/defaulters" end>
        Defaulters
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/collections">
        Collections
      </NavLink>
    </div>
  );
}

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
            onClick={() => printId("print-fees-defaulters")}
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
          {String(error?.message || "Failed to load report")}
        </div>
      )}

      {report && (
        <PrintDocument
          id="print-fees-defaulters"
          className="space-y-3 bg-white"
        >
          {/* optional: report title/subtitle for print-only */}
          <div className="hidden print:block">
            <div className="text-base font-semibold">Fees Defaulters Report</div>
            <div className="text-sm opacity-70">
              {selectedClass
                ? fmtClass(selectedClass)
                : `Class ${String(classId)}`}{" "}
              • {term} {year} • Min Balance: {minBalance}
            </div>
          </div>

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
                      <td>{fmtName(r.student)}</td>
                      <td className="text-right">{fmtMoney(r.balance)}</td>
                      <td className="text-right">{fmtMoney(r.paid)}</td>
                      <td className="text-right">{fmtMoney(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

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
