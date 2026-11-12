// A learner's fee statement for the learner or their parent: what is owed
// across all terms, credit, and every invoice and payment.
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";
import { useSchoolCalendar, dateIn } from "@/lib/schoolCalendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;

export default function PortalStatementPage() {
  const { studentId } = useParams();
  const { timezone, termLabels } = useSchoolCalendar();
  const q = useQuery({
    queryKey: ["portalStatement", studentId],
    queryFn: () => api.get(`/api/fees/students/${studentId}/statement`).then((r) => r.data),
    retry: false,
  });
  const d = q.data;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Button asChild variant="outline" size="sm">
        <Link to="/app/dashboard">Back</Link>
      </Button>
      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <div className="text-sm text-destructive">{q.error?.response?.data?.message || "Couldn't load the statement."}</div>}
      {d && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">
              {d.student.firstName} {d.student.lastName}
            </h1>
            <div className="text-sm text-muted-foreground">Fee statement · {d.student.admissionNo}</div>
          </div>
          <Card>
            <CardContent className="pt-4 grid gap-2 sm:grid-cols-3 text-sm">
              <div>
                Owed (all terms): <b>{kes(d.account.owed)}</b>
              </div>
              <div>
                Credit: <b>{kes(d.account.credit)}</b>
              </div>
              <div>
                {d.account.net > 0 ? "Balance due" : "In credit"}: <b>{kes(Math.abs(d.account.net))}</b>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Invoices and payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {d.timeline.length === 0 && <div className="text-muted-foreground">Nothing yet.</div>}
              {[...d.timeline].reverse().map((t, i) => (
                <div key={i} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                  <div>
                    <div className="font-medium">
                      {t.type === "PAYMENT" ? `Payment · ${t.method}` : `Invoice · ${termLabels?.[t.term] || t.term} ${t.year}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dateIn(t.at, timezone)}
                      {t.type === "PAYMENT" && t.receiptNo ? ` · Receipt ${t.receiptNo}` : ""}
                      {t.type === "PAYMENT" && t.toCredit > 0 ? ` · ${kes(t.toCredit)} kept as credit` : ""}
                    </div>
                  </div>
                  <div className={t.type === "PAYMENT" ? "text-green-700 dark:text-green-400 font-medium" : "font-medium"}>
                    {t.type === "PAYMENT" ? "−" : ""}
                    {kes(t.amount)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
