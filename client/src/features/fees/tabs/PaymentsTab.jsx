// The payments ledger: every receipt the school has issued, newest first, a
// page at a time, with a period, method and search filter and the total
// collected for whatever is showing. Any receipt can be reprinted from here.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, Search } from "lucide-react";

import { listFeePayments, openReceiptPdf } from "@/api/fees.api";
import { getErrorMessage } from "@/lib/errors";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import usePageFor from "@/hooks/usePageFor";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Pager from "@/components/ui/pager";
import { Panel } from "@/components/insights/Insights";
import { ChartCard, ColumnsChart } from "@/components/insights/Charts";

import { money } from "../components/FeeMoney";

const PAGE_SIZE = 25;
const METHOD_LABEL = { CASH: "Cash", MPESA: "M-Pesa", BANK: "Bank", CHEQUE: "Cheque", OTHER: "Other" };

/** "YYYY-MM-DD" n days from a date string. */
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "24 Aug 2026" from "2026-08-24". */
const prettyDay = (day) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "";

/** The preset periods, worked out from today in the school's time zone. */
function periods(today, termDates, termLabel) {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const list = [
    { key: "today", label: "Today", from: today, to: today },
    { key: "week", label: "This week", from: addDays(today, -dow), to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  ];
  if (termDates) list.push({ key: "term", label: termLabel || "This term", from: termDates.startsOn, to: termDates.endsOn });
  list.push({ key: "all", label: "Any time", from: "", to: "" });
  return list;
}

function getLastReceipt() {
  try {
    return JSON.parse(localStorage.getItem("fees:lastReceipt") || "null");
  } catch {
    return null;
  }
}

export default function PaymentsTab() {
  const { today, timezone, currentTermDates, currentTerm, termLabels } = useSchoolCalendar();
  const presets = periods(today, currentTermDates, currentTerm ? termLabels[currentTerm] : null);

  const [periodKey, setPeriodKey] = useState(currentTermDates ? "term" : "month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const preset = presets.find((p) => p.key === periodKey);
  const { from, to } = periodKey === "custom" ? custom : preset || presets[presets.length - 1];

  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [page, goTo] = usePageFor(`${from}|${to}|${method}|${query}`);

  const q = useQuery({
    queryKey: ["feePayments", { from, to, method, q: query, page }],
    queryFn: () => listFeePayments({ from: from || undefined, to: to || undefined, method: method || undefined, q: query || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });
  const items = q.data?.items || [];
  const total = q.data?.total || 0;
  const totals = q.data?.totals;
  // Money in per day (or month) for the chart, labelled the way people say it.
  const periodPoints = (totals?.series || []).map((x) => ({
    key: x.period,
    label:
      totals.bucket === "month"
        ? new Date(`${x.period}-01T00:00:00Z`).toLocaleDateString("en-KE", { timeZone: "UTC", month: "short", year: "numeric" })
        : new Date(`${x.period}T00:00:00Z`).toLocaleDateString("en-KE", { timeZone: "UTC", day: "numeric", month: "short" }),
    value: x.amount,
    display: money(x.amount),
  }));
  // Imported or M-Pesa payments have no cashier; drop the column when none do.
  const showBy = items.some((p) => p.receivedByName);

  const [opening, setOpening] = useState(null);
  const printPdf = async (id) => {
    if (!id || opening) return;
    setOpening(id);
    try {
      await openReceiptPdf(id);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't open that receipt."));
    } finally {
      setOpening(null);
    }
  };

  const [last, setLast] = useState(getLastReceipt);
  const when = (d) =>
    new Date(d).toLocaleString("en-KE", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const learner = (s) => (s ? `${s.firstName} ${s.lastName}`.trim() : "—");
  const klass = (s) => (s?.class ? [s.class.name, s.class.stream].filter(Boolean).join(" ") : "");

  return (
    <div className="space-y-4">
      {last?.paymentId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span>
            Last receipt you issued: <b>{last.receiptNo || "—"}</b> · {money(last.amount || 0)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => printPdf(last.paymentId)} disabled={!!opening}>
              Print again
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                localStorage.removeItem("fees:lastReceipt");
                setLast(null);
              }}
            >
              Dismiss
            </Button>
          </span>
        </div>
      )}

      {/* Period, then the money for it */}
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => (
          <Button key={p.key} size="sm" variant={periodKey === p.key ? "default" : "outline"} onClick={() => setPeriodKey(p.key)}>
            {p.label}
          </Button>
        ))}
        <Button size="sm" variant={periodKey === "custom" ? "default" : "outline"} onClick={() => {
          setCustom({ from: from || addDays(today, -30), to: to || today });
          setPeriodKey("custom");
        }}>
          Dates…
        </Button>
        {periodKey === "custom" && (
          <span className="flex items-center gap-1.5">
            <Input type="date" aria-label="From" className="h-9 w-auto" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="h-9 w-auto" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <ChartCard
          className="sm:col-span-2"
          title="Collected"
          value={totals ? money(totals.amount) : "—"}
          caption={
            totals
              ? `${totals.count.toLocaleString()} receipt${totals.count === 1 ? "" : "s"}${totals.reversed ? ` · ${totals.reversed} reversed (not counted)` : ""}`
              : " "
          }
          chart={(size) => (
            <ColumnsChart
              points={periodPoints}
              compact={size === "compact"}
              height={size === "compact" ? 64 : 260}
              ariaLabel={`Money collected per ${totals?.bucket || "day"}`}
            />
          )}
          table={{ columns: [totals?.bucket === "month" ? "Month" : "Day", "Collected"], rows: periodPoints.map((p) => [p.label, p.display]) }}
          note={totals?.bucket === "month" ? "Shown by month because the period is longer than three months." : "Days with no payments show as zero."}
        />
        <div className="rounded-2xl border bg-card p-4 shadow-sm sm:col-span-2 lg:col-span-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">By method</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(totals?.byMethod || []).length === 0 && <span className="text-sm text-muted-foreground">No payments in this period.</span>}
            {(totals?.byMethod || []).map((m) => (
              <button
                key={m.method}
                type="button"
                onClick={() => setMethod(method === m.method ? "" : m.method)}
                className={`rounded-xl border px-3 py-1.5 text-left text-sm transition hover:bg-muted ${method === m.method ? "border-primary ring-1 ring-primary" : ""}`}
                title={method === m.method ? "Show every method" : `Only ${METHOD_LABEL[m.method] || m.method}`}
              >
                <div className="font-semibold tabular-nums">{money(m.amount)}</div>
                <div className="text-xs text-muted-foreground">
                  {METHOD_LABEL[m.method] || m.method} · {m.count}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Panel
        title="Receipts"
        subtitle={from || to ? `${prettyDay(from) || "The start"} to ${prettyDay(to) || "today"}` : "Every payment received"}
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select
              aria-label="Method"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">All methods</option>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-9 w-full pl-8 sm:w-60"
                placeholder="Receipt, learner or M-Pesa code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        }
      >
        {q.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payments…
          </div>
        ) : q.isError ? (
          <div className="py-8 text-sm text-destructive">{getErrorMessage(q.error, "Couldn't load payments.")}</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No payments{query ? ` matching "${query}"` : ""} in this period.
          </div>
        ) : (
          <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl">
            {/* Laptop: a table */}
            <table className="hidden w-full text-sm md:table">
              <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-2 py-2 font-medium">Receipt</th>
                  <th className="px-2 py-2 font-medium">Learner</th>
                  <th className="px-2 py-2 font-medium">Method</th>
                  {showBy && <th className="px-2 py-2 font-medium">Taken by</th>}
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={`border-b last:border-0 ${p.isReversed ? "text-muted-foreground" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-2.5">{when(p.receivedAt)}</td>
                    <td className="px-2 py-2.5 font-mono text-xs">{p.receiptNo || "—"}</td>
                    <td className="px-2 py-2.5">
                      <div className="font-medium">{learner(p.student)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.student?.admissionNo}
                        {klass(p.student) ? ` · ${klass(p.student)}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      {METHOD_LABEL[p.method] || p.method}
                      {p.reference && <div className="font-mono text-xs text-muted-foreground">{p.reference}</div>}
                    </td>
                    {showBy && <td className="px-2 py-2.5 text-muted-foreground">{p.receivedByName || "—"}</td>}
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums">
                      <span className={p.isReversed ? "line-through" : ""}>{money(p.amount)}</span>
                      {p.isReversed && (
                        <Badge variant="destructive" className="ml-2">
                          Reversed
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => printPdf(p.id)} disabled={opening === p.id}>
                        {opening === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        Receipt
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phone: one line per payment */}
            <ul className="divide-y border-t md:hidden">
              {items.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{learner(p.student)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {when(p.receivedAt)} · {METHOD_LABEL[p.method] || p.method}
                      {p.isReversed ? " · reversed" : ""}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{p.receiptNo}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={`font-semibold tabular-nums ${p.isReversed ? "text-muted-foreground line-through" : ""}`}>{money(p.amount)}</span>
                    <Button size="icon" variant="ghost" aria-label="Receipt" onClick={() => printPdf(p.id)} disabled={opening === p.id}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <Pager page={page} pageSize={PAGE_SIZE} total={total} busy={q.isFetching} onGo={goTo} noun="payments" />
          </div>
        )}
      </Panel>
    </div>
  );
}
