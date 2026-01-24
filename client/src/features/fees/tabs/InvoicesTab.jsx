import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { listFeeInvoices, getFeeInvoice } from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import QueryBlock from "../components/QueryBlock";
import { money } from "../components/FeeMoney";

export default function InvoicesTab() {
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState("TERM1");
  const [status, setStatus] = useState("");

  const classesQ = useQuery({ queryKey: ["classes"], queryFn: () => listClasses({}) });

  const invoicesQ = useQuery({
    queryKey: ["feeInvoices", { studentId, classId, year, term, status }],
    queryFn: () =>
      listFeeInvoices({
        studentId: studentId || undefined,
        classId: classId || undefined,
        year: year || undefined,
        term: term || undefined,
        status: status || undefined,
      }),
  });

  const invoiceDetailsMut = useMutation({ mutationFn: getFeeInvoice });

  const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
  const invoices = Array.isArray(invoicesQ.data) ? invoicesQ.data : [];

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Input placeholder="StudentId (optional)" value={studentId} onChange={(e) => setStudentId(e.target.value)} />

          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.stream ? ` ${c.stream}` : ""} ({c.year})
              </option>
            ))}
          </select>

          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />

          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="TERM1">TERM1</option>
            <option value="TERM2">TERM2</option>
            <option value="TERM3">TERM3</option>
          </select>

          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses…</option>
            <option value="ISSUED">ISSUED</option>
            <option value="PARTIALLY_PAID">PARTIALLY_PAID</option>
            <option value="PAID">PAID</option>
            <option value="VOID">VOID</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Invoices</span>
            <span className="text-xs text-muted-foreground">{invoices.length} found</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          <QueryBlock
            isLoading={invoicesQ.isLoading}
            isError={invoicesQ.isError}
            error={invoicesQ.error}
            empty={!invoicesQ.isLoading && !invoicesQ.isError && invoices.length === 0}
            emptyText="No invoices found for your filters."
          >
            <div className="grid gap-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="border rounded-md p-3 bg-background flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Invoice</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.term} {inv.year} • Status: {inv.status} • Total: {money(inv.total)} • Paid: {money(inv.paid)} • Balance: {money(inv.balance)}
                    </div>
                  </div>

                  <Button size="sm" variant="outline" onClick={() => invoiceDetailsMut.mutate(inv.id)} disabled={invoiceDetailsMut.isPending}>
                    View
                  </Button>
                </div>
              ))}
            </div>
          </QueryBlock>

          {invoiceDetailsMut.isError && (
            <div className="text-sm text-destructive">
              {invoiceDetailsMut.error?.response?.data?.message || "Failed to load invoice details."}
            </div>
          )}

          {invoiceDetailsMut.data && (
            <Card className="mt-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Invoice details</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="text-xs text-muted-foreground">Invoice ID: {invoiceDetailsMut.data.id}</div>

                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{invoiceDetailsMut.data.status}</Badge>
                  <Badge variant="secondary">Total {money(invoiceDetailsMut.data.total)}</Badge>
                  <Badge variant="secondary">Paid {money(invoiceDetailsMut.data.paid)}</Badge>
                  <Badge variant="secondary">Balance {money(invoiceDetailsMut.data.balance)}</Badge>
                </div>

                <Separator />

                <div className="font-medium">Lines</div>
                <div className="grid gap-1">
                  {(invoiceDetailsMut.data.lines || []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs">
                      <span>{l.feeItem?.name || l.feeItemId}</span>
                      <span className="font-medium">{money(l.amount)}</span>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="font-medium">Payments</div>
                <div className="grid gap-1">
                  {(invoiceDetailsMut.data.payments || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span>{p.method} • {p.receiptNo || "—"}</span>
                      <span className="font-medium">{money(p.amount)}</span>
                    </div>
                  ))}
                  {(invoiceDetailsMut.data.payments || []).length === 0 && (
                    <div className="text-xs text-muted-foreground">No payments yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
