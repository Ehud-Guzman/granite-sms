// A learner's fee statement for the learner or their parent: what is owed
// across all terms, credit, and every invoice and payment, newest first.
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Button } from "@/components/ui/button";
import { HeroPanel, Panel, EmptyNote } from "@/components/insights/Insights";

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const METHOD_LABEL = { CASH: "Cash", MPESA: "M-Pesa", BANK: "Bank", CHEQUE: "Cheque", OTHER: "Other" };
const day = (d, tz) => {
  try {
    return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(d));
  } catch {
    return "";
  }
};

export default function PortalStatementPage({ studentId: studentIdProp }) {
  const params = useParams();
  const studentId = studentIdProp || params.studentId;
  const { timezone, termLabels } = useSchoolCalendar();
  const isParent = useMe().data?.user?.role === "PARENT";
  const q = useQuery({
    queryKey: ["portalStatement", studentId],
    queryFn: () => api.get(`/api/fees/students/${studentId}/statement`).then((r) => r.data),
    enabled: !!studentId,
    retry: false,
  });
  const d = q.data;
  const a = d?.account;
  const paidIn = (d?.timeline || []).filter((t) => t.type === "PAYMENT").reduce((n, t) => n + Number(t.amount || 0), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      {isParent && (
        <Button asChild variant="outline" size="sm">
          <Link to="/app/dashboard">← Your children</Link>
        </Button>
      )}
      {q.isLoading && <div className="h-40 animate-pulse rounded-3xl bg-muted" />}
      {q.isError && <div className="text-sm text-destructive">{q.error?.response?.data?.message || "Couldn't load the statement."}</div>}
      {d && (
        <>
          <HeroPanel
            eyebrow={`Fee statement · ${d.student.firstName} ${d.student.lastName} · ${d.student.admissionNo}`}
            value={a.net > 0 ? kes(a.net) : a.net < 0 ? kes(-a.net) : "Fully paid"}
            caption={a.net > 0 ? "balance due" : a.net < 0 ? "in credit, used on the next invoice" : "nothing owed"}
            minis={[
              { label: "Owed, all terms", value: kes(a.owed), alert: a.owed > 0 },
              { label: "Credit", value: kes(a.credit) },
              { label: "Paid so far", value: kes(paidIn) },
            ]}
          />
          <Panel title="Invoices and payments" subtitle="Newest first">
            {d.timeline.length === 0 && <EmptyNote>Nothing yet.</EmptyNote>}
            <ol className="divide-y">
              {[...d.timeline].reverse().map((t, i) => {
                const pay = t.type === "PAYMENT";
                return (
                  <li key={i} className="flex items-start justify-between gap-3 py-3">
                    <div className="flex min-w-0 gap-3">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${pay ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {pay ? `Payment · ${METHOD_LABEL[t.method] || t.method}` : `Invoice · ${termLabels?.[t.term] || t.term} ${t.year}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {day(t.at, timezone)}
                          {pay && t.receiptNo ? ` · ${t.receiptNo}` : ""}
                          {pay && t.toCredit > 0 ? ` · ${kes(t.toCredit)} kept as credit` : ""}
                        </div>
                      </div>
                    </div>
                    <div className={`shrink-0 font-semibold tabular-nums ${pay ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                      {pay ? "−" : ""}
                      {kes(t.amount)}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </>
      )}
    </div>
  );
}
