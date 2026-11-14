// Collections: money received between two dates, day by day (or month by
// month for long ranges), split by payment method, with the receipts a page
// at a time. The server sums the whole range (byDay, byMethod, count); the
// export downloads every receipt.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getFeesCollections, exportFeesCollections } from "@/api/feesReports.api";
import { printSection } from "@/lib/print";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import usePageFor from "@/hooks/usePageFor";
import Pager from "@/components/ui/pager";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Panel, ColumnChart, SegmentBar } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, TextInput, ReportState } from "../components/ReportKit";
import { fmtKes, fmtDate, fmtDateTime } from "../utils/format";
import FinanceNav from "./FinanceNav";

const METHOD_LABEL = { CASH: "Cash", MPESA: "M-Pesa", BANK: "Bank", CHEQUE: "Cheque", OTHER: "Other" };
const METHOD_TONE = { MPESA: "good", CASH: "sky", BANK: "violet", CHEQUE: "muted", OTHER: "muted" };
const PAGE_SIZE = 50;

function daysBetween(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export default function FeesCollectionsReport() {
  const { today } = useSchoolCalendar();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  const params = useMemo(() => (from && to && from <= to ? { from, to } : null), [from, to]);
  const [page, goTo] = usePageFor(`${from}|${to}`);
  const q = useQuery({
    queryKey: ["feesReports", "collections", params, page],
    queryFn: () => getFeesCollections({ ...params, page, pageSize: PAGE_SIZE }),
    enabled: Boolean(params),
    placeholderData: (prev) => prev,
  });
  const r = q.data;
  const payments = r?.payments || [];
  const count = r?.count || 0;

  // Day by day in the school's time zone (the server groups by local day);
  // month by month past ~2 months.
  const series = useMemo(() => {
    if (!params) return [];
    const days = daysBetween(params.from, params.to);
    const monthly = days.length > 62;
    const key = (iso) => (monthly ? iso.slice(0, 7) : iso);
    const buckets = new Map();
    for (const d of days) if (!buckets.has(key(d))) buckets.set(key(d), 0);
    for (const d of r?.byDay || []) {
      const k = key(d.date);
      if (buckets.has(k)) buckets.set(k, buckets.get(k) + Number(d.amount || 0));
    }
    return [...buckets].map(([k, v]) => ({
      key: k,
      label: monthly
        ? new Intl.DateTimeFormat("en-KE", { month: "short" }).format(new Date(`${k}-15T12:00:00Z`))
        : new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(`${k}T12:00:00Z`)),
      value: v,
      display: fmtKes(v),
    }));
  }, [r, params]);

  const best = series.reduce((b, p) => (p.value > (b?.value || 0) ? p : b), null);
  const activeDays = series.filter((p) => p.value > 0).length;
  const methods = Object.entries(r?.byMethod || {}).sort((a, b) => b[1] - a[1]);
  const span = params ? `${fmtDate(`${params.from}T12:00:00Z`)} – ${fmtDate(`${params.to}T12:00:00Z`)}` : "";

  return (
    <div className="space-y-4">
      <FinanceNav />
      <ReportHeader
        title="Collections"
        subtitle={`Money received · ${span}`}
        ready={Boolean(r)}
        onExport={(format) => exportFeesCollections(params, format)}
        onPrint={() => printSection("print-fees-collections")}
      />
      <FilterBar>
        <Field label="From">
          <TextInput type="date" value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={to} onChange={setTo} />
        </Field>
        <div className="flex gap-2">
          {[
            ["This month", `${today.slice(0, 7)}-01`, today],
            ["This year", `${today.slice(0, 4)}-01-01`, today],
          ].map(([label, f, t]) => (
            <button key={label} type="button" onClick={() => {
                setFrom(f);
                setTo(t);
              }} className="h-9 rounded-md border px-3 text-sm hover:border-primary">
              {label}
            </button>
          ))}
        </div>
      </FilterBar>

      {from > to && <ReportState error="The start date is after the end date." />}
      <ReportState loading={q.isLoading} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {r && (
        <PrintDocument screen id="print-fees-collections" bodyClassName="space-y-4">
          <ReportPrintTitle title="Collections" subtitle={span} />
          {count === 0 ? (
            <ReportState prompt="No payments were received in this period." />
          ) : (
            <>
              <HeroPanel
                eyebrow={`Received · ${span}`}
                value={fmtKes(r.totalCollected)}
                caption={`${count.toLocaleString()} receipt${count === 1 ? "" : "s"}`}
                minis={[
                  { label: "Average receipt", value: fmtKes(r.totalCollected / count) },
                  { label: "Best day", value: best ? `${best.label} · ${fmtKes(best.value)}` : "—" },
                  { label: "Days with payments", value: `${activeDays} of ${series.length}` },
                ]}
              />
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel title={series.length > 62 ? "By month" : "By day"} className="lg:col-span-2">
                  <ColumnChart points={series} ariaLabel="Fees collected over the period" />
                </Panel>
                <Panel title="By method">
                  <SegmentBar
                    segments={methods.map(([m, v]) => ({ label: METHOD_LABEL[m] || m, value: v, display: fmtKes(v), tone: METHOD_TONE[m] || "muted" }))}
                  />
                </Panel>
              </div>
              <Panel title={`Receipts (${count.toLocaleString()})`}>
                <div className="max-h-[520px] overflow-auto print:max-h-none">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card print:static">
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 px-3 font-medium">Receipt</th>
                        <th className="py-2 px-3 font-medium">Method</th>
                        <th className="py-2 px-3 font-medium">Reference</th>
                        <th className="py-2 pl-3 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p, i) => (
                        <tr key={p.id || p.receiptNo || i} className="border-b last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(p.receivedAt)}</td>
                          <td className="py-2 px-3">{p.receiptNo || "—"}</td>
                          <td className="py-2 px-3">{METHOD_LABEL[p.method] || p.method || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground">{p.reference || "—"}</td>
                          <td className="py-2 pl-3 text-right font-medium tabular-nums">{fmtKes(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  className="-mx-5 -mb-5 mt-3 rounded-b-2xl print:hidden"
                  page={r.page || page}
                  pageSize={r.pageSize || PAGE_SIZE}
                  total={count}
                  busy={q.isFetching}
                  onGo={goTo}
                  noun="receipts"
                />
                {count > payments.length && (
                  <p className="hidden pt-2 text-xs text-muted-foreground print:block">
                    {payments.length} of {count.toLocaleString()} receipts shown. Export to Excel or CSV for the full list.
                  </p>
                )}
              </Panel>
              <ReportPrintFooter />
            </>
          )}
        </PrintDocument>
      )}
    </div>
  );
}
