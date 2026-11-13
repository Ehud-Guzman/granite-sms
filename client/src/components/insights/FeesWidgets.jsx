// The fee panels shared by the staff dashboard and the Fees overview tab.
// They take the "fees" block of GET /api/dashboard/summary.
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Panel, HeroPanel, Ring, BarList, ColumnChart } from "./Insights";

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const shortDay = (iso) => {
  try {
    return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
};

export function FeesHero({ fees, termLabel }) {
  const t = fees.term;
  if (!t || !t.invoices) {
    return (
      <HeroPanel eyebrow="Fees" value={kes(fees.collectedToday)} caption={`collected today · ${fees.receiptsToday} receipt${fees.receiptsToday === 1 ? "" : "s"}`} minis={[{ label: "Outstanding", value: kes(fees.outstandingTotal), alert: fees.outstandingTotal > 0 }]} />
    );
  }
  return (
    <HeroPanel
      eyebrow={`Collected · ${termLabel}`}
      value={kes(t.paid)}
      caption={`of ${kes(t.billed)} billed on ${t.invoices.toLocaleString()} invoice${t.invoices === 1 ? "" : "s"}`}
      minis={[
        { label: "Still owed", value: kes(t.balance), alert: t.balance > 0 },
        { label: "Today", value: kes(fees.collectedToday) },
        { label: "Receipts today", value: fees.receiptsToday.toLocaleString() },
        { label: "Fully paid", value: `${t.fullyPaid.toLocaleString()} of ${t.invoices.toLocaleString()}` },
      ]}
      aside={
        <Ring percent={t.percent} size={136} stroke={14} tone={t.percent >= 100 ? "good" : "#ffffff"} track="rgba(255,255,255,0.18)" label={`${t.percent}% of term fees collected`}>
          <span className="text-3xl font-extrabold tabular-nums leading-none">{Math.round(t.percent)}%</span>
          <span className="mt-1 text-xs text-white/75 print:text-black/70">collected</span>
        </Ring>
      }
    />
  );
}

export function FeesTrend({ fees }) {
  const trend = fees.trend || [];
  const total = trend.reduce((n, d) => n + d.amount, 0);
  return (
    <Panel
      title="Collections, last 14 days"
      subtitle={`${kes(total)} in ${trend.reduce((n, d) => n + d.receipts, 0)} receipts`}
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/reports/fees/collections">Details</Link>
        </Button>
      }
    >
      <ColumnChart
        points={trend.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.amount, display: kes(d.amount) }))}
        ariaLabel="Fees collected each day for the last 14 days"
        empty="No payments in the last 14 days."
        highlightLast
      />
    </Panel>
  );
}

export function OwedByClass({ fees }) {
  const rows = fees.byClass || [];
  return (
    <Panel
      title="Most owed, by class"
      subtitle="This term's unpaid balances"
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/reports/fees/defaulters">Who owes</Link>
        </Button>
      }
    >
      <BarList
        tone="alert"
        empty="Nothing owed this term."
        items={rows.map((c) => ({
          key: c.classId,
          label: c.label,
          value: c.balance,
          display: kes(c.balance),
          sub: c.billed ? `${Math.round((c.balance / c.billed) * 100)}% unpaid` : null,
        }))}
      />
    </Panel>
  );
}

