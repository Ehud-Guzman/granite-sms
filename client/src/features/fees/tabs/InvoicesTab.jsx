import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { listClasses } from "@/api/classes.api";
import {
  listFeeInvoices,
  getFeeInvoice,
  listFeePlans,
  generateInvoicesBulk,
  voidFeeInvoice,
  applyInvoiceDiscount,
} from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import QueryBlock from "../components/QueryBlock";
import SimpleModal from "../components/SimpleModal";
import { money } from "../components/FeeMoney";

const norm = (v) => String(v || "").trim().toUpperCase();

export default function InvoicesTab() {
  const qc = useQueryClient();

  const { data: meData } = useMe();
  const role = norm(meData?.user?.role);
  const isAdmin = role === "ADMIN";

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

  const refreshList = () => qc.invalidateQueries({ queryKey: ["feeInvoices"] });

  // -------------------------
  // Bulk invoice generation (ADMIN only)
  // -------------------------
  const plansQ = useQuery({
    queryKey: ["feePlans", { classId, year, term }],
    queryFn: () => listFeePlans({ classId, year, term }),
    enabled: isAdmin && !!classId && !!year && !!term,
  });
  const plans = Array.isArray(plansQ.data) ? plansQ.data : [];
  const chosenPlan = plans?.[0] || null;

  const bulkGenMut = useMutation({
    mutationFn: generateInvoicesBulk,
    onSuccess: () => refreshList(),
  });

  const doBulkGenerate = () => {
    if (!classId || !chosenPlan?.id) return;
    bulkGenMut.mutate({ classId, year, term, feePlanId: chosenPlan.id });
  };

  // -------------------------
  // Void invoice (ADMIN only)
  // -------------------------
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const voidMut = useMutation({
    mutationFn: ({ invoiceId, reason }) => voidFeeInvoice(invoiceId, { reason }),
    onSuccess: () => {
      invoiceDetailsMut.mutate(invoiceDetailsMut.variables);
      refreshList();
      setVoidOpen(false);
      setVoidReason("");
    },
  });

  // -------------------------
  // Discount / waiver (ADMIN only)
  // -------------------------
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const discountMut = useMutation({
    mutationFn: ({ invoiceId, amount, reason }) =>
      applyInvoiceDiscount(invoiceId, { amount, reason }),
    onSuccess: () => {
      invoiceDetailsMut.mutate(invoiceDetailsMut.variables);
      refreshList();
      setDiscountOpen(false);
      setDiscountAmount("");
      setDiscountReason("");
    },
  });

  const detail = invoiceDetailsMut.data;
  const detailIsVoid = norm(detail?.status) === "VOID";
  const maxDiscount = useMemo(() => {
    if (!detail) return 0;
    return Math.max(Number(detail.total || 0) - Number(detail.paid || 0), 0);
  }, [detail]);

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

      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bulk generate invoices for this class</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Uses the current class/year/term filters above. Students already invoiced for that
              period are skipped automatically.
            </div>

            {!classId ? (
              <div className="text-xs text-muted-foreground">Select a class above to enable bulk generation.</div>
            ) : plansQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Checking fee plan…</div>
            ) : !chosenPlan ? (
              <div className="text-xs text-destructive">No fee plan found for this class/year/term.</div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Plan: <span className="font-medium text-foreground">{chosenPlan.title || "Fee Plan"}</span>
              </div>
            )}

            <Button size="sm" onClick={doBulkGenerate} disabled={!chosenPlan || bulkGenMut.isPending}>
              {bulkGenMut.isPending ? "Generating…" : "Generate for whole class"}
            </Button>

            {bulkGenMut.isError && (
              <div className="text-sm text-destructive">
                {bulkGenMut.error?.response?.data?.message || "Bulk generation failed."}
              </div>
            )}

            {bulkGenMut.data && (
              <div className="text-sm border rounded-md p-2 mt-1">
                Created <span className="font-medium">{bulkGenMut.data.createdCount}</span>, skipped{" "}
                <span className="font-medium">{bulkGenMut.data.skippedCount}</span>.
                {bulkGenMut.data.skippedCount > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Skipped (already invoiced):{" "}
                    {bulkGenMut.data.skipped.map((s) => s.admissionNo || s.studentId).join(", ")}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

          {detail && (
            <Card className="mt-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>Invoice details</span>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDiscountOpen(true)}
                        disabled={detailIsVoid}
                      >
                        Apply discount
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setVoidOpen(true)}
                        disabled={detailIsVoid}
                      >
                        Void
                      </Button>
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="text-xs text-muted-foreground">Invoice ID: {detail.id}</div>

                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{detail.status}</Badge>
                  <Badge variant="secondary">Total {money(detail.total)}</Badge>
                  {!!detail.discount && (
                    <Badge variant="secondary">Discount {money(detail.discount)}</Badge>
                  )}
                  <Badge variant="secondary">Paid {money(detail.paid)}</Badge>
                  <Badge variant="secondary">Balance {money(detail.balance)}</Badge>
                </div>

                {!!detail.discount && (
                  <div className="text-xs text-muted-foreground">
                    Discount reason: {detail.discountReason || "—"}
                  </div>
                )}

                <Separator />

                <div className="font-medium">Lines</div>
                <div className="grid gap-1">
                  {(detail.lines || []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs">
                      <span>{l.feeItem?.name || l.feeItemId}</span>
                      <span className="font-medium">{money(l.amount)}</span>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="font-medium">Payments</div>
                <div className="grid gap-1">
                  {(detail.payments || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span>{p.method} • {p.receiptNo || "—"}</span>
                      <span className="font-medium">{money(p.amount)}</span>
                    </div>
                  ))}
                  {(detail.payments || []).length === 0 && (
                    <div className="text-xs text-muted-foreground">No payments yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <SimpleModal
        title="Void invoice"
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!voidReason.trim() || voidMut.isPending}
              onClick={() => voidMut.mutate({ invoiceId: detail.id, reason: voidReason.trim() })}
            >
              {voidMut.isPending ? "Voiding…" : "Void invoice"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Voiding is only allowed if the invoice has no active (unreversed) payments.
          </div>
          <Input
            placeholder="Reason (required)"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          {voidMut.isError && (
            <div className="text-sm text-destructive">
              {voidMut.error?.response?.data?.message || "Failed to void invoice."}
            </div>
          )}
        </div>
      </SimpleModal>

      <SimpleModal
        title="Apply discount / waiver"
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscountOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !discountReason.trim() ||
                !(Number(discountAmount) >= 0) ||
                !Number.isInteger(Number(discountAmount)) ||
                Number(discountAmount) > maxDiscount ||
                discountMut.isPending
              }
              onClick={() =>
                discountMut.mutate({
                  invoiceId: detail.id,
                  amount: Number(discountAmount),
                  reason: discountReason.trim(),
                })
              }
            >
              {discountMut.isPending ? "Applying…" : "Apply discount"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Sets the invoice's discount to this amount (replaces any prior discount). Max allowed
            right now: <span className="font-medium text-foreground">{money(maxDiscount)}</span>.
          </div>
          <Input
            type="number"
            step="1"
            min="0"
            placeholder="Discount amount"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
          />
          {discountAmount !== "" && !Number.isInteger(Number(discountAmount)) && (
            <div className="text-sm text-destructive">Discount must be a whole number (no cents/decimals).</div>
          )}
          <Input
            placeholder="Reason (required)"
            value={discountReason}
            onChange={(e) => setDiscountReason(e.target.value)}
          />
          {discountMut.isError && (
            <div className="text-sm text-destructive">
              {discountMut.error?.response?.data?.message || "Failed to apply discount."}
            </div>
          )}
        </div>
      </SimpleModal>
    </div>
  );
}
