import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getFeesCollections, exportFeesCollections } from "@/api/feesReports.api";
import { printSection } from "@/lib/print";
import { fmtMoney, fmtDateTime } from "../utils/format";
import { getErrorMessage as errMsg } from "@/lib/errors";

import PrintDocument from "@/components/print/PrintDocument";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import FinanceNav from "./FinanceNav";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function PaymentsTable({ payments, sticky }) {
  return (
    <table className="w-full text-sm">
      <thead className={`text-left opacity-70 border-b ${sticky ? "sticky top-0 bg-white" : ""}`}>
        <tr>
          <th className="py-2">Date</th>
          <th>Receipt</th>
          <th>Method</th>
          <th>Ref</th>
          <th className="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p, idx) => (
          <tr
            key={p.receiptNo || `${p.invoiceId}-${p.receivedAt}-${idx}`}
            className="border-t"
          >
            <td className="py-2">{fmtDateTime(p.receivedAt)}</td>
            <td>{p.receiptNo || "-"}</td>
            <td>{p.method || "-"}</td>
            <td>{p.reference || "-"}</td>
            <td className="text-right">{fmtMoney(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const payments = report?.payments || [];

  const [exporting, setExporting] = useState(false);
  const doExport = async (format) => {
    if (!params) return;
    setExporting(true);
    try {
      await exportFeesCollections(params, format);
    } catch (err) {
      console.error("EXPORT FEES COLLECTIONS ERROR:", err);
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
          <h2 className="text-xl font-semibold">Finance — Fees Collections</h2>
          <p className="opacity-70 mt-1">
            Collections by date range (posted payments only).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => doExport("csv")}
            disabled={!canPrint || exporting}
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => doExport("xlsx")}
            disabled={!canPrint || exporting}
          >
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => printSection("print-fees-collections")}
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
          {errMsg(error, "Failed to load report")}
        </div>
      )}

      {report && (
        <PrintDocument
          id="print-fees-collections"
          className="space-y-3 bg-white"
        >
          <ReportPrintTitle title="Fees Collections Report" subtitle={printSubtitle} />

          {/* empty state */}
          {Number(report.count ?? 0) === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <div className="font-medium">No collections found</div>
                <div className="text-sm opacity-70 mt-1">
                  There were no posted payments for this period.
                </div>

                <ReportPrintFooter />
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
                    <PaymentsTable payments={payments} sticky />
                  </div>

                  {/* Print table (no sticky header) */}
                  <div className="hidden print:block">
                    <PaymentsTable payments={payments} />
                  </div>

                  <ReportPrintFooter />
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
