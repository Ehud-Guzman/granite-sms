import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { getStudent } from "@/features/students/students.api";

import { getStudentFeesSummary, getStudentFeesStatement } from "@/api/fees.api";

import { Input } from "@/components/ui/input";

import StudentLookupByAdmission from "../components/StudentLookupByAdmission";
import QueryBlock from "../components/QueryBlock";
import { money } from "../components/FeeMoney";
import { useCurrentTermState, useCurrentYearState, useSchoolCalendar } from "@/lib/schoolCalendar";

export default function StudentStatementTab() {
  const { timezone, termLabels } = useSchoolCalendar();
  const [year, setYear] = useCurrentYearState();
  const [term, setTerm] = useCurrentTermState();

  // The learner picked here by admission number, or the one named in the
  // address (?student=<id>, e.g. from the search box) until someone picks.
  const [params] = useSearchParams();
  const linkedId = params.get("student");
  const linkedQ = useQuery({ queryKey: ["student", linkedId], queryFn: () => getStudent(linkedId), enabled: !!linkedId });
  const [picked, setStudent] = useState(null);
  const student = picked ?? (linkedId ? linkedQ.data ?? null : null);
  const studentId = student?.id || "";

  const summaryQ = useQuery({
    queryKey: ["studentFeesSummary", { studentId, year, term }],
    queryFn: () => getStudentFeesSummary(studentId, { year, term }),
    enabled: !!studentId,
    retry: 1,
  });

  const statementQ = useQuery({
    queryKey: ["studentFeesStatement", { studentId, year, term }],
    queryFn: () => getStudentFeesStatement(studentId, { year, term }),
    enabled: !!studentId,
    retry: 1,
  });

  // ✅ Normalize summary so UI never crashes
  const summary = summaryQ.data ?? null;
  const total = summary?.total ?? 0;
  const discount = summary?.discount ?? 0;
  const paid = summary?.paid ?? 0;
  const balance = summary?.balance ?? 0;
  const count = summary?.count ?? 0;

  const timeline = useMemo(() => {
    const tl = statementQ.data?.timeline;
    return Array.isArray(tl) ? tl : [];
  }, [statementQ.data]);

  // The ledger: bills, bursaries and payments in date order with the balance
  // after each, like a bank statement.
  const ledger = useMemo(() => {
    let bal = 0;
    const out = [];
    for (const t of timeline) {
      if (t.type === "INVOICE") {
        bal += Number(t.amount || 0);
        out.push({ key: `i-${t.ref}`, at: t.at, what: `Fees for ${termLabels[t.term] || t.term || ""} ${t.year || ""}`.trim(), ref: t.invoiceNo, charge: t.amount, balance: bal });
        if (t.discount > 0) {
          bal -= Number(t.discount);
          out.push({ key: `d-${t.ref}`, at: t.at, what: "Bursary / discount", ref: t.invoiceNo, credit: t.discount, balance: bal });
        }
      } else if (t.type === "PAYMENT") {
        bal -= Number(t.amount || 0);
        const method = { MPESA: "M-Pesa", CASH: "Cash", BANK: "Bank", CHEQUE: "Cheque" }[t.method] || "Payment";
        out.push({
          key: `p-${t.ref}`,
          at: t.at,
          what: `${method} payment${t.reference ? ` · ${t.reference}` : ""}`,
          ref: t.receiptNo,
          credit: t.amount,
          balance: bal,
          note: t.toCredit > 0 ? `${money(t.toCredit)} kept as credit` : "",
        });
      }
    }
    return out;
  }, [timeline, termLabels]);

  const account = statementQ.data?.account;

  return (
    <div className="min-w-0 space-y-4">
      {/* Who, and which term */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <StudentLookupByAdmission
            label="Learner's admission number"
            onSelect={(s) => setStudent(s)}
            helperText="Or press Ctrl K anywhere and type the learner's name."
          />
          <div className="flex gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Year</span>
              <Input type="number" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Term</span>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={term} onChange={(e) => setTerm(e.target.value)}>
                {["TERM1", "TERM2", "TERM3"].map((t) => (
                  <option key={t} value={t}>
                    {termLabels[t] || t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {linkedId && linkedQ.isLoading && !picked && <div className="mt-3 text-sm text-muted-foreground">Loading the learner…</div>}
      </section>

      {!!studentId && (
        <>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {student.firstName} {student.lastName}
                </h2>
                <div className="text-sm text-muted-foreground">
                  {student.admissionNo}
                  {student.class ? ` · ${student.class.name}${student.class.stream ? ` ${student.class.stream}` : ""}` : ""} · {termLabels[term] || term} {year}
                </div>
              </div>
              {account && (
                <div className={`rounded-full px-3 py-1 text-sm font-semibold ${account.net > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
                  {account.net > 0 ? `Owes ${money(account.net)} in all` : account.net < 0 ? `${money(-account.net)} in credit` : "Fully paid"}
                </div>
              )}
            </div>

            <QueryBlock
              isLoading={summaryQ.isLoading}
              isError={summaryQ.isError}
              error={summaryQ.error}
              empty={!summaryQ.isLoading && !summaryQ.isError && !summary}
              emptyText="Nothing billed for this term."
            >
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Billed", total],
                  ["Bursary", discount],
                  ["Paid", paid],
                  ["Balance this term", balance],
                ].map(([label, v]) => (
                  <div key={label} className="rounded-xl border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className={`text-lg font-bold tabular-nums ${label.startsWith("Balance") && v > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{money(v)}</div>
                  </div>
                ))}
              </div>
              {count > 1 && <div className="mt-2 text-xs text-muted-foreground">{count} invoices this term</div>}
            </QueryBlock>
          </section>

          <section className="rounded-2xl border bg-card shadow-sm">
            <div className="px-5 pb-3 pt-5">
              <h2 className="font-semibold">Statement</h2>
              <p className="text-xs text-muted-foreground">Bills and payments for {termLabels[term] || term} {year}, oldest first.</p>
            </div>
            <QueryBlock
              isLoading={statementQ.isLoading}
              isError={statementQ.isError}
              error={statementQ.error}
              empty={!statementQ.isLoading && !statementQ.isError && ledger.length === 0}
              emptyText="No bills or payments this term."
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 font-medium">Date</th>
                      <th className="px-2 py-2 font-medium">Details</th>
                      <th className="px-2 py-2 text-right font-medium">Charged</th>
                      <th className="px-2 py-2 text-right font-medium">Paid</th>
                      <th className="px-5 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((r) => (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">{r.at ? new Date(r.at).toLocaleDateString("en-KE", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                        <td className="px-2 py-2.5">
                          <div className="font-medium">{r.what}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.ref}
                            {r.note ? ` · ${r.note}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{r.charge ? money(r.charge) : ""}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.credit ? money(r.credit) : ""}</td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{money(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </QueryBlock>
          </section>
        </>
      )}
    </div>
  );
}
