// Who owes: learners with an unpaid balance for a term, biggest first. The
// whole school by default; the list is the bursar's phone-call list.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { getFeesDefaulters, exportFeesDefaulters } from "@/api/feesReports.api";
import { printSection } from "@/lib/print";
import { useCurrentTermState, useCurrentYearState, useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Panel, BarList } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, SelectInput, TextInput, ReportState } from "../components/ReportKit";
import { normalizeArray, fmtClass, fmtKes } from "../utils/format";
import FinanceNav from "./FinanceNav";

const TERMS = ["TERM1", "TERM2", "TERM3"];
const STATUS = { ISSUED: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid" };

export default function FeesDefaultersReport() {
  const { termLabels } = useSchoolCalendar();
  const [classId, setClassId] = useState("");
  const [year, setYear] = useCurrentYearState(true);
  const [term, setTerm] = useCurrentTermState();
  const [minBalance, setMinBalance] = useState("1");
  const [limit, setLimit] = useState("100");

  const classesQ = useQuery({ queryKey: ["classes", "active"], queryFn: () => listClasses({ active: true }) });
  const classes = useMemo(() => normalizeArray(classesQ.data), [classesQ.data]);
  const selectedClass = classes.find((c) => String(c.id) === String(classId)) || null;

  const params =
    year && term
      ? { year: Number(year), term, minBalance: Number(minBalance) || 1, limit: Number(limit) || 100, ...(classId ? { classId } : {}) }
      : null;
  const q = useQuery({ queryKey: ["feesReports", "defaulters", params], queryFn: () => getFeesDefaulters(params), enabled: Boolean(params) });
  const r = q.data;
  const rows = r?.rows || [];
  const termName = `${termLabels?.[term] || term} ${year}`;
  const scope = selectedClass ? fmtClass(selectedClass) : "All classes";
  const shownTotal = rows.reduce((n, x) => n + Number(x.balance || 0), 0);

  return (
    <div className="space-y-4">
      <FinanceNav />
      <ReportHeader
        title="Who owes"
        subtitle={`${scope} · ${termName} · balances of at least ${fmtKes(minBalance)}`}
        ready={Boolean(r)}
        onExport={(format) => exportFeesDefaulters(params, format)}
        onPrint={() => printSection("print-fees-defaulters")}
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
        <Field label="Owing at least (KES)">
          <TextInput value={minBalance} onChange={setMinBalance} inputMode="numeric" className="w-32" />
        </Field>
        <Field label="Show">
          <SelectInput value={limit} onChange={setLimit}>
            {["25", "50", "100", "250", "500"].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </SelectInput>
        </Field>
      </FilterBar>

      <ReportState loading={q.isLoading} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {r && (
        <PrintDocument screen id="print-fees-defaulters" bodyClassName="space-y-4">
          <ReportPrintTitle title="Who owes" subtitle={`${scope} · ${termName}`} />
          {rows.length === 0 ? (
            <ReportState prompt={`Nobody owes ${fmtKes(minBalance)} or more for ${termName}.`} />
          ) : (
            <>
              <HeroPanel
                eyebrow={`Owed · ${scope} · ${termName}`}
                value={fmtKes(r.totalOutstanding ?? shownTotal)}
                caption={`by ${(r.totalCount ?? rows.length).toLocaleString()} learner${(r.totalCount ?? rows.length) === 1 ? "" : "s"}`}
                minis={[
                  { label: "Listed below", value: rows.length.toLocaleString() },
                  { label: "Largest balance", value: fmtKes(rows[0]?.balance) },
                  { label: "Average owed", value: fmtKes((r.totalOutstanding ?? shownTotal) / Math.max(1, r.totalCount ?? rows.length)) },
                ]}
              />

              <Panel title="Largest balances" subtitle="Start the calls here">
                <BarList
                  tone="alert"
                  items={rows.slice(0, 8).map((x) => ({
                    key: x.invoiceId,
                    label: x.student?.name || x.student?.admissionNo,
                    sub: [x.student?.admissionNo, x.className].filter(Boolean).join(" · "),
                    value: x.balance,
                    display: fmtKes(x.balance),
                  }))}
                />
              </Panel>

              <Panel title={`Everyone listed (${rows.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">#</th>
                        <th className="py-2 px-3 font-medium">Learner</th>
                        {!classId && <th className="py-2 px-3 font-medium">Class</th>}
                        <th className="py-2 px-3 text-right font-medium">Billed</th>
                        <th className="py-2 px-3 text-right font-medium">Paid</th>
                        <th className="py-2 px-3 text-right font-medium">Owed</th>
                        <th className="py-2 pl-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x, i) => (
                        <tr key={x.invoiceId} className="border-b last:border-0">
                          <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="py-2 px-3">
                            <div className="font-medium">{x.student?.name || "—"}</div>
                            <div className="text-xs text-muted-foreground">{x.student?.admissionNo}</div>
                          </td>
                          {!classId && <td className="py-2 px-3">{x.className || "—"}</td>}
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(x.total)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtKes(x.paid)}</td>
                          <td className="py-2 px-3 text-right font-semibold tabular-nums text-red-700 dark:text-red-400">{fmtKes(x.balance)}</td>
                          <td className="py-2 pl-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${x.status === "PARTIALLY_PAID" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"}`}>
                              {STATUS[x.status] || x.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.totalCount > rows.length && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing the {rows.length} largest of {r.totalCount}. Export for the full list, or raise &quot;Show&quot;.
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
