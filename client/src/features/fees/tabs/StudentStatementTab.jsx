import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getStudentFeesSummary, getStudentFeesStatement } from "@/api/fees.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import StudentLookupByAdmission from "../components/StudentLookupByAdmission";
import QueryBlock from "../components/QueryBlock";
import { money } from "../components/FeeMoney";

export default function StudentStatementTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState("TERM1");

  // Store student object once selected by admissionNo
  const [student, setStudent] = useState(null);
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
  const paid = summary?.paid ?? 0;
  const balance = summary?.balance ?? 0;
  const count = summary?.count ?? 0;

  const timeline = useMemo(() => {
    const tl = statementQ.data?.timeline;
    return Array.isArray(tl) ? tl : [];
  }, [statementQ.data]);

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lookup (Admission No)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <StudentLookupByAdmission
            onSelect={(s) => setStudent(s)}
            helperText="Use Admission No. The system will fetch statement using the internal student ID."
          />

          <div className="grid gap-3 md:grid-cols-4">
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />

            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              <option value="TERM1">TERM1</option>
              <option value="TERM2">TERM2</option>
              <option value="TERM3">TERM3</option>
            </select>

            {student && (
              <div className="md:col-span-2 text-sm">
                <div className="font-medium">
                  {student.firstName} {student.lastName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Adm: {student.admissionNo} • (internal id hidden)
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!!studentId && (
        <>
          {/* SUMMARY */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>

            <CardContent className="text-sm space-y-1">
              <QueryBlock
                isLoading={summaryQ.isLoading}
                isError={summaryQ.isError}
                error={summaryQ.error}
                empty={!summaryQ.isLoading && !summaryQ.isError && !summary}
                emptyText="No summary found for this student/term."
              >
                <div className="space-y-1">
                  <div>
                    Total billed: <b>{money(total)}</b>
                  </div>
                  <div>
                    Total paid: <b>{money(paid)}</b>
                  </div>
                  <div>
                    Balance: <b>{money(balance)}</b>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Invoices: {count}
                  </div>
                </div>
              </QueryBlock>
            </CardContent>
          </Card>

          {/* TIMELINE */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>

            <CardContent className="space-y-2">
              <QueryBlock
                isLoading={statementQ.isLoading}
                isError={statementQ.isError}
                error={statementQ.error}
                empty={!statementQ.isLoading && !statementQ.isError && timeline.length === 0}
                emptyText="No invoices/payments found for this term/year."
              >
                <div className="space-y-2">
                  {timeline.map((t, i) => (
                    <div key={i} className="border rounded-md p-2 text-sm">
                      <div className="font-medium">{t.type}</div>

                      <div className="text-xs text-muted-foreground">
                        {t.at ? new Date(t.at).toISOString().slice(0, 10) : "—"} •{" "}
                        {t.type === "PAYMENT"
                          ? `Receipt ${t.receiptNo || "—"}`
                          : `Invoice ${t.ref ? String(t.ref).slice(0, 8) + "…" : "—"}`}
                      </div>

                      <div className="text-xs">
                        Amount: <b>{money(t.amount ?? 0)}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </QueryBlock>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
