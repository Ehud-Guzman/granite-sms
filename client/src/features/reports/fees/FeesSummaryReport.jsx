// Fees summary: what was billed for a term, what came in, and which classes
// are behind. The whole school by default; pick a class to narrow it.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { getFeesClassSummary, exportFeesClassSummary } from "@/api/feesReports.api";
import { printSection } from "@/lib/print";
import { useCurrentTermState, useCurrentYearState, useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Ring, Panel, SegmentBar, BarList } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, SelectInput, TextInput, ReportState } from "../components/ReportKit";
import { normalizeArray, fmtClass, fmtKes } from "../utils/format";
import FinanceNav from "./FinanceNav";

const TERMS = ["TERM1", "TERM2", "TERM3"];
const pctTone = (p) => (p >= 90 ? "good" : p >= 60 ? "primary" : p >= 40 ? "warn" : "alert");

export default function FeesSummaryReport() {
  const { termLabels } = useSchoolCalendar();
  const [classId, setClassId] = useState("");
  const [year, setYear] = useCurrentYearState(true);
  const [term, setTerm] = useCurrentTermState();

  const classesQ = useQuery({ queryKey: ["classes", "active"], queryFn: () => listClasses({ active: true }) });
  const classes = useMemo(() => normalizeArray(classesQ.data), [classesQ.data]);
  const selectedClass = classes.find((c) => String(c.id) === String(classId)) || null;

  const params = year && term ? { year: Number(year), term, ...(classId ? { classId } : {}) } : null;
  const q = useQuery({
    queryKey: ["feesReports", "classSummary", params],
    queryFn: () => getFeesClassSummary(params),
    enabled: Boolean(params),
  });
  const r = q.data;
  const pct = r?.totalBilled ? (r.totalPaid / r.totalBilled) * 100 : 0;
  const termName = `${termLabels?.[term] || term} ${year}`;
  const scope = selectedClass ? fmtClass(selectedClass) : "All classes";
  const sc = r?.statusCounts || {};
  const byClass = r?.byClass || [];

  return (
    <div className="space-y-4">
      <FinanceNav />
      <ReportHeader
        title="Fees summary"
        subtitle={`${scope} · ${termName}`}
        ready={Boolean(r)}
        onExport={(format) => exportFeesClassSummary(params, format)}
        onPrint={() => printSection("print-fees-summary")}
        pdfFrom="print-fees-summary"
      />
      <FilterBar>
        <Field label="Class">
          <SelectInput value={classId} onChange={setClassId} className="min-w-48">
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {fmtClass(c)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Year">
          <TextInput value={year} onChange={setYear} inputMode="numeric" className="w-24" />
        </Field>
        <Field label="Term">
          <SelectInput value={term} onChange={setTerm}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {termLabels?.[t] || t}
              </option>
            ))}
          </SelectInput>
        </Field>
      </FilterBar>

      <ReportState loading={q.isLoading} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {r && (
        <PrintDocument screen id="print-fees-summary" bodyClassName="space-y-4">
          <ReportPrintTitle title="Fees summary" subtitle={`${scope} · ${termName}`} />
          {r.invoiceCount === 0 ? (
            <ReportState prompt={`No invoices for ${scope.toLowerCase()} in ${termName} yet.`} />
          ) : (
            <>
              <HeroPanel
                eyebrow={`Collected · ${scope} · ${termName}`}
                value={fmtKes(r.totalPaid)}
                caption={`of ${fmtKes(r.totalBilled)} billed`}
                minis={[
                  { label: "Still owed", value: fmtKes(r.totalBalance), alert: r.totalBalance > 0 },
                  { label: "Invoices", value: r.invoiceCount.toLocaleString() },
                  { label: "Fully paid", value: (sc.PAID || 0).toLocaleString() },
                ]}
                aside={
                  <Ring percent={pct} size={136} stroke={14} tone={pct >= 100 ? "good" : "#ffffff"} track="rgba(255,255,255,0.18)" label={`${pct.toFixed(1)}% collected`}>
                    <span className="text-3xl font-extrabold tabular-nums leading-none">{Math.round(pct)}%</span>
                    <span className="mt-1 text-xs text-white/75 print:text-black/70">collected</span>
                  </Ring>
                }
              />

              <div className="grid items-start gap-4 lg:grid-cols-5">
                <Panel title="Invoices by status" subtitle="How many learners have cleared the term" className="lg:col-span-2">
                  <SegmentBar
                    segments={[
                      { label: "Paid", value: sc.PAID || 0, tone: "good" },
                      { label: "Part paid", value: sc.PARTIALLY_PAID || 0, tone: "warn" },
                      { label: "Unpaid", value: sc.ISSUED || 0, tone: "alert" },
                    ]}
                  />
                </Panel>
                <Panel title="Collected, by class" subtitle="Share of each class's bill paid so far" className="lg:col-span-3">
                  <BarList
                    max={100}
                    empty="No classes billed."
                    items={[...byClass]
                      .sort((a, b) => a.collectionPct - b.collectionPct)
                      .map((c) => ({
                        key: c.classId,
                        label: `${c.className}${c.stream ? ` ${c.stream}` : ""}`,
                        value: c.collectionPct,
                        display: `${Math.round(c.collectionPct)}%`,
                        sub: `${fmtKes(c.totalBalance)} owed`,
                        tone: pctTone(c.collectionPct),
                      }))}
                  />
                </Panel>
              </div>

              <Panel title="Class by class">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Class</th>
                        <th className="py-2 px-3 text-right font-medium">Invoices</th>
                        <th className="py-2 px-3 text-right font-medium">Billed</th>
                        <th className="py-2 px-3 text-right font-medium">Paid</th>
                        <th className="py-2 px-3 text-right font-medium">Owed</th>
                        <th className="py-2 pl-3 text-right font-medium">Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byClass.map((c) => (
                        <tr key={c.classId} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">
                            {c.className}
                            {c.stream ? ` ${c.stream}` : ""}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">{c.invoiceCount}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(c.totalBilled)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(c.totalPaid)}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${c.totalBalance > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{fmtKes(c.totalBalance)}</td>
                          <td className="py-2 pl-3 text-right font-semibold tabular-nums">{Math.round(c.collectionPct)}%</td>
                        </tr>
                      ))}
                    </tbody>
                    {byClass.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 font-semibold">
                          <td className="py-2 pr-3">Total</td>
                          <td className="py-2 px-3 text-right tabular-nums">{r.invoiceCount}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(r.totalBilled)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(r.totalPaid)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(r.totalBalance)}</td>
                          <td className="py-2 pl-3 text-right tabular-nums">{Math.round(pct)}%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Panel>
              <ReportPrintFooter />
            </>
          )}
        </PrintDocument>
      )}
    </div>
  );
}
