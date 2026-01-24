import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getFeesCollections } from "@/api/feesReports.api";
import { printId } from "../utils/print";

import PrintDocument from "@/components/print/PrintDocument";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fmtMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString();
}

function fmtDateTime(d = new Date()) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
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
      <NavLink className={linkCls} to="/app/reports/fees/defaulters">
        Defaulters
      </NavLink>
      <NavLink className={linkCls} to="/app/reports/fees/collections" end>
        Collections
      </NavLink>
    </div>
  );
}

export default function FeesCollectionsReport() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  const [from, setFrom] = useState(`${yyyy}-${mm}-01`);
  const [to, setTo] = useState(`${yyyy}-${mm}-${dd}`);

  const params = useMemo(() => {
    if (!from || !to) return null;
    return { from, to };
  }, [from, to]);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["feesReports", "collections", params],
    queryFn: () => getFeesCollections(params),
    enabled: Boolean(params),
  });

  const canPrint = Boolean(report);
  const printSubtitle = report ? `From ${report.from} to ${report.to}` : "";
  const showHint = !report && !isLoading && !error;

  return (
    <div className="space-y-4">
      {/* top bar */}
      <div className="flex items-start justify-between gap-3 flex-wrap no-print">
        <div>
          <h2 className="text-xl font-semibold">Finance — Fees Collections</h2>
          <p className="opacity-70 mt-1">
            Collections by date range (posted payments only).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => printId("print-fees-collections")}
            disabled={!canPrint}
            title={!canPrint ? "Load a report first" : "Print this report"}
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
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs opacity-70">From</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">To</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {showHint && (
        <div className="no-print text-sm opacity-70">
          Adjust the date range to view fee collections.
        </div>
      )}

      {isLoading && <div className="opacity-70 no-print">Loading report…</div>}

      {error && (
        <div className="text-red-600 no-print">
          {String(error?.message || "Failed to load report")}
        </div>
      )}

      {report && (
        <PrintDocument
          id="print-fees-collections"
          className="space-y-3 bg-white"
        >
          {/* optional: report title/subtitle for print-only */}
          <div className="hidden print:block mb-2">
            <div className="text-base font-semibold">
              Fees Collections Report
            </div>
            {printSubtitle ? (
              <div className="text-sm opacity-70">{printSubtitle}</div>
            ) : null}
          </div>

          {/* empty state */}
          {Number(report.count ?? 0) === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <div className="font-medium">No collections found</div>
                <div className="text-sm opacity-70 mt-1">
                  There were no posted payments for this period.
                </div>

                <div className="mt-4 text-xs opacity-70">
                  Printed: {fmtDateTime()}
                </div>
                <div className="mt-6 flex justify-between text-xs">
                  <div>Signature: ____________________</div>
                  <div>Date: ____________________</div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* totals */}
              <Card>
                <CardHeader>
                  <CardTitle>Totals</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs opacity-70">Total Collected</div>
                    <div className="text-2xl font-semibold">
                      {fmtMoney(report.totalCollected)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70">Payments Count</div>
                    <div className="text-2xl font-semibold">
                      {Number(report.count ?? 0).toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-70">By Method</div>
                    <div className="mt-2 space-y-1">
                      {Object.keys(report.byMethod || {}).length === 0 ? (
                        <div className="text-sm opacity-70">No breakdown</div>
                      ) : (
                        Object.entries(report.byMethod).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex justify-between gap-3 text-sm"
                          >
                            <span className="opacity-70">{k}</span>
                            <span className="font-medium">{fmtMoney(v)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* payments */}
              <Card>
                <CardHeader>
                  <CardTitle>Payments</CardTitle>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <div className="max-h-[520px] overflow-auto no-print">
                    <table className="w-full text-sm">
                      <thead className="text-left opacity-70 sticky top-0 bg-white border-b">
                        <tr>
                          <th className="py-2">Date</th>
                          <th>Receipt</th>
                          <th>Method</th>
                          <th>Ref</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.payments || []).map((p, idx) => (
                          <tr
                            key={
                              p.receiptNo ||
                              `${p.invoiceId}-${p.receivedAt}-${idx}`
                            }
                            className="border-t"
                          >
                            <td className="py-2">
                              {fmtDateTime(p.receivedAt)}
                            </td>
                            <td>{p.receiptNo || "-"}</td>
                            <td>{p.method || "-"}</td>
                            <td>{p.reference || "-"}</td>
                            <td className="text-right">{fmtMoney(p.amount)}</td>
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
                          <th className="py-2">Date</th>
                          <th>Receipt</th>
                          <th>Method</th>
                          <th>Ref</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.payments || []).map((p, idx) => (
                          <tr
                            key={
                              p.receiptNo ||
                              `${p.invoiceId}-${p.receivedAt}-${idx}`
                            }
                            className="border-t"
                          >
                            <td className="py-2">
                              {fmtDateTime(p.receivedAt)}
                            </td>
                            <td>{p.receiptNo || "-"}</td>
                            <td>{p.method || "-"}</td>
                            <td>{p.reference || "-"}</td>
                            <td className="text-right">{fmtMoney(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 text-xs opacity-70">
                    Printed: {fmtDateTime()}
                  </div>
                  <div className="mt-6 flex justify-between text-xs">
                    <div>Signature: ____________________</div>
                    <div>Date: ____________________</div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

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
