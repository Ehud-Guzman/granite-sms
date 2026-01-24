// src/features/fees/tabs/FeeCashierTab.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { me } from "@/api/auth.api";
import {
  getFeesSubscription,
  listFeeInvoices,
  listFeePlans,
  generateInvoice,
  createFeePayment,
  getPaymentReceiptJson,
  reverseFeePayment,
  voidFeeInvoice,
} from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import StudentLookupByAdmission from "../components/StudentLookupByAdmission";
import QueryBlock from "../components/QueryBlock";
import SimpleModal from "../components/SimpleModal";
import { money, toNumberOrZero } from "../components/FeeMoney";

const PAYMENT_METHODS = ["CASH", "MPESA", "BANK", "CHEQUE", "OTHER"];
const TERMS = ["TERM1", "TERM2", "TERM3"];

const norm = (v) => String(v || "").trim().toUpperCase();

function getInitialLastReceipt() {
  try {
    return JSON.parse(localStorage.getItem("fees:lastReceipt") || "null");
  } catch {
    return null;
  }
}

export default function FeeCashierTab({ onReceiptReady }) {
  const qc = useQueryClient();

  // filters (cashier context)
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [term, setTerm] = useState("TERM1");

  // student selection
  const [selectedStudent, setSelectedStudent] = useState(null);
  const studentId = selectedStudent?.id || "";
  const classId = selectedStudent?.classId || "";

  // invoice selection + payment form
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");

  // last receipt cache (quick reprint)
  const [lastReceipt, setLastReceipt] = useState(() => getInitialLastReceipt());

  const persistReceipt = (obj) => {
    setLastReceipt(obj);
    localStorage.setItem("fees:lastReceipt", JSON.stringify(obj));
  };

  const clearReceipt = () => {
    setLastReceipt(null);
    localStorage.removeItem("fees:lastReceipt");
  };

  // modals
  const [reverseOpen, setReverseOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [selectedPaymentForReverse, setSelectedPaymentForReverse] = useState(null);

  // speed UX
  const amountRef = useRef(null);

  // prevent double print dialogs
  const printingRef = useRef(false);

  // -------------------------
  // Role / auth
  // -------------------------
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: me,
    staleTime: 60 * 1000,
  });

  const role = norm(meQ.data?.user?.role);

  const isAdmin = role === "ADMIN";
  const isBursar = role === "BURSAR";

  // Capabilities (single truth)
  const canPostPayment = isAdmin || isBursar;
  const canReversePayment = isAdmin || isBursar; // realistic school flow
  const canGenerateInvoice = isAdmin; // admin only
  const canVoidInvoice = isAdmin; // admin only

  // defense-in-depth: this tab should only be used by cashier roles
  const isCashierRole = canPostPayment;

  // -------------------------
  // Subscription gating
  // -------------------------
  const subQ = useQuery({
    queryKey: ["feesSubscription"],
    queryFn: getFeesSubscription,
    staleTime: 60 * 1000,
  });

  // backend: { mode: "SUBSCRIBED" | "READ_ONLY" }
  const isReadOnly = subQ.data?.mode === "READ_ONLY";

  // -------------------------
  // Data: fee plans & invoices
  // -------------------------
  const plansQ = useQuery({
    queryKey: ["feePlans", { classId, year, term }],
    queryFn: () => listFeePlans({ classId, year, term }),
    enabled: !!classId && !!year && !!term,
  });

  const plans = useMemo(() => {
    const d = plansQ.data;
    return Array.isArray(d) ? d : d?.items || [];
  }, [plansQ.data]);

  const chosenPlan = plans?.[0] || null;

  const invQ = useQuery({
    queryKey: ["feeInvoices", { studentId, year, term }],
    queryFn: () => listFeeInvoices({ studentId, year, term }),
    enabled: !!studentId,
  });

  const invoices = useMemo(() => {
    const d = invQ.data;
    return Array.isArray(d) ? d : d?.items || [];
  }, [invQ.data]);

  const activeInvoice = useMemo(() => {
    if (!invoices.length) return null;
    if (selectedInvoiceId) return invoices.find((i) => i.id === selectedInvoiceId) || null;
    const withBal = invoices.find((i) => toNumberOrZero(i.balance) > 0);
    return withBal || invoices[0] || null;
  }, [invoices, selectedInvoiceId]);

  const activeInvoiceId = activeInvoice?.id || "";
  const activeInvoiceBalance = toNumberOrZero(activeInvoice?.balance);
  const activeInvoiceIsVoid = String(activeInvoice?.status || "").toUpperCase() === "VOID";

  const activePayments = useMemo(() => {
    const p = activeInvoice?.payments;
    return Array.isArray(p) ? p : [];
  }, [activeInvoice?.payments]);

  // -------------------------
  // PRINT ENGINE (single path)
  // -------------------------
  const printReceiptOnce = useCallback(
    async (receiptJson) => {
      if (!receiptJson) return;

      if (printingRef.current) return;
      printingRef.current = true;

      // render target (ReceiptPrint is mounted elsewhere)
      onReceiptReady?.(receiptJson);

      // whitelist print target
      document.documentElement.dataset.printing = "print-fees-receipt";

      const cleanup = () => {
        delete document.documentElement.dataset.printing;
        window.removeEventListener("afterprint", cleanup);
        window.onafterprint = null;
        printingRef.current = false;
      };

      window.addEventListener("afterprint", cleanup, { once: true });
      window.onafterprint = cleanup;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            window.print();
          } finally {
            // failsafe
            setTimeout(() => {
              if (printingRef.current) cleanup();
            }, 1500);
          }
        });
      });
    },
    [onReceiptReady]
  );

  const printPaymentId = useCallback(
    async (paymentId) => {
      if (!paymentId) return;
      try {
        const receiptJson = await getPaymentReceiptJson(paymentId);
        if (!receiptJson) {
          toast.error("Receipt data not found");
          return;
        }
        await printReceiptOnce(receiptJson);
      } catch (err) {
        console.error("PRINT ERROR:", err);
        toast.error("Failed to load receipt for printing");
      }
    },
    [printReceiptOnce]
  );

  // -------------------------
  // Mutations
  // -------------------------
  const genInvMut = useMutation({
    mutationFn: generateInvoice,
    onSuccess: async (inv) => {
      await qc.invalidateQueries({ queryKey: ["feeInvoices", { studentId, year, term }] });

      setSelectedInvoiceId(inv?.id || "");
      const bal = toNumberOrZero(inv?.balance);
      setAmount(bal > 0 ? String(bal) : "");
      setTimeout(() => amountRef.current?.focus(), 50);
      toast.success("Invoice generated");
    },
    onError: (err) => {
      console.log("GENERATE INVOICE ERROR:", err?.response?.data || err);
      toast.error(err?.response?.data?.message || "Failed to generate invoice");
    },
  });

  const payMut = useMutation({
    mutationFn: createFeePayment,
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["feeInvoices", { studentId, year, term }] });

      const payment = res?.payment || null;
      if (!payment?.id) {
        toast.error("Payment saved but missing ID");
        return;
      }

      // reset form
      setAmount("");
      setReference("");

      // cache quick reprint
      persistReceipt({
        paymentId: payment.id,
        receiptNo: payment.receiptNo || "—",
        method: payment.method || method,
        amount: toNumberOrZero(payment.amount),
        createdAt: payment.createdAt || null,
      });

      toast.success("Payment posted");

      // print
      await printPaymentId(payment.id);
    },
    onError: (err) => {
      console.log("PAYMENT ERROR:", err?.response?.data || err);
      toast.error(err?.response?.data?.message || "Payment failed");
    },
  });

  const reverseMut = useMutation({
    mutationFn: async ({ paymentId, reason }) => reverseFeePayment(paymentId, { reason }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["feeInvoices", { studentId, year, term }] });
      setReverseReason("");
      setReverseOpen(false);
      setSelectedPaymentForReverse(null);
      toast.success("Payment reversed");
    },
    onError: (err) => {
      console.log("REVERSE ERROR:", err?.response?.data || err);
      toast.error(err?.response?.data?.message || "Failed to reverse payment");
    },
  });

  const voidMut = useMutation({
    mutationFn: async ({ invoiceId, reason }) => voidFeeInvoice(invoiceId, { reason }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["feeInvoices", { studentId, year, term }] });
      setVoidReason("");
      setVoidOpen(false);
      toast.success("Invoice voided");
    },
    onError: (err) => {
      console.log("VOID ERROR:", err?.response?.data || err);
      toast.error(err?.response?.data?.message || "Failed to void invoice");
    },
  });

  // -------------------------
  // Handlers
  // -------------------------
  const onSelectStudent = (s) => {
    setSelectedStudent(s || null);
    setSelectedInvoiceId("");
    setAmount("");
    setReference("");
  };

  const doGenerateInvoice = () => {
    if (!studentId) return toast.error("Select a student first");
    if (!canGenerateInvoice) return toast.error("Only ADMIN can generate invoices");
    if (isReadOnly) return toast.error("Fees module is in read-only mode");

    if (!classId) return toast.error("Student has no class assigned. Assign class first.");
    if (!chosenPlan?.id) return toast.error("No fee plan for this class/year/term.");

    genInvMut.mutate({ studentId, classId, year, term, feePlanId: chosenPlan.id });
  };

  const startPay = (inv) => {
    if (!inv?.id) return;
    setSelectedInvoiceId(inv.id);
    const bal = toNumberOrZero(inv.balance);
    setAmount(bal > 0 ? String(bal) : "");
    setTimeout(() => amountRef.current?.focus(), 50);
  };

  const submitPayment = () => {
    if (!canPostPayment) return toast.error("You are not allowed to post payments");
    if (isReadOnly) return toast.error("Read-only mode");
    if (!activeInvoiceId) return toast.error("No invoice selected");
    if (activeInvoiceIsVoid) return toast.error("Cannot pay a VOID invoice");

    const amt = toNumberOrZero(amount);
    if (amt <= 0) return toast.error("Enter a valid amount");
    if (amt > activeInvoiceBalance) return toast.error("Overpayment is not allowed");

    payMut.mutate({
      invoiceId: activeInvoiceId,
      amount: amt,
      method,
      reference: reference.trim() || undefined,
    });
  };

  const askReverse = (p) => {
    if (!p) return;
    if (!canReversePayment) return toast.error("You are not allowed to reverse payments");
    setSelectedPaymentForReverse(p);
    setReverseReason("");
    setReverseOpen(true);
  };

  const confirmReverse = () => {
    if (!selectedPaymentForReverse?.id) return;
    if (!canReversePayment) return toast.error("Not allowed");
    const reason = reverseReason.trim();
    if (!reason) return toast.error("Reason is required");
    if (isReadOnly) return toast.error("Read-only mode");
    reverseMut.mutate({ paymentId: selectedPaymentForReverse.id, reason });
  };

  const confirmVoid = () => {
    if (!activeInvoice?.id) return;
    if (!canVoidInvoice) return toast.error("Only ADMIN can void invoices");
    const reason = voidReason.trim();
    if (!reason) return toast.error("Reason is required");
    if (isReadOnly) return toast.error("Read-only mode");
    voidMut.mutate({ invoiceId: activeInvoice.id, reason });
  };

  const printLastReceipt = async () => {
    if (!lastReceipt?.paymentId) return toast.error("No cached receipt");
    await printPaymentId(lastReceipt.paymentId);
  };

  // Enter key on amount input posts payment (cashier speed)
  useEffect(() => {
    const onKey = (e) => {
      const isEnter = e.key === "Enter";
      const focusedAmount = document.activeElement === amountRef.current;
      const modalOpen = reverseOpen || voidOpen;
      if (!isEnter || !focusedAmount || modalOpen) return;
      submitPayment();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, method, reference, activeInvoiceId, isReadOnly, reverseOpen, voidOpen, role]);

  // -------------------------
  // UI
  // -------------------------
  if (meQ.isLoading) return <div className="p-6">Loading...</div>;

  if (!isCashierRole) {
    return (
      <Card>
        <CardContent className="py-4 text-sm">
          <div className="font-medium">Cashier tools are staff-only</div>
          <div className="text-muted-foreground mt-1">
            Your role (<span className="font-medium">{role || "UNKNOWN"}</span>) can’t post payments.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* READ-ONLY banner */}
      {subQ.isSuccess && isReadOnly && (
        <Card>
          <CardContent className="py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Fees module is in read-only mode</div>
                <div className="text-muted-foreground">
                  This school subscription does not include payments posting.
                </div>
              </div>
              <Badge variant="secondary">Read-only</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Receive Payment</span>
            <Badge variant="outline">{isAdmin ? "ADMIN" : "BURSAR"}</Badge>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-6">
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Year</div>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))}
              />
            </div>

            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Term</div>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              >
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 flex items-end justify-end">
              {lastReceipt?.paymentId ? (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={printLastReceipt}>
                    Print / Save PDF
                  </Button>
                  <Button variant="ghost" onClick={clearReceipt}>
                    Clear
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No recent receipt.</div>
              )}
            </div>
          </div>

          <div className="border rounded-md p-3">
            <div className="text-sm font-medium mb-2">Find student</div>
            <StudentLookupByAdmission onSelect={onSelectStudent} />
          </div>
        </CardContent>
      </Card>

      {/* Student block */}
      {studentId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {selectedStudent?.firstName || "Student"} {selectedStudent?.lastName || ""}
                <span className="text-muted-foreground font-normal">
                  {" "}
                  ({selectedStudent?.admissionNo || "—"})
                </span>
              </span>

              <div className="flex gap-2">
                <Badge variant="outline">{term}</Badge>
                <Badge variant="outline">{year}</Badge>
              </div>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Billing setup status */}
            <div className="border rounded-md p-3">
              <div className="font-medium">Billing Setup</div>
              <div className="text-xs text-muted-foreground mt-1">
                Class:{" "}
                <span className="font-medium">
                  {selectedStudent?.class?.name}
                  {selectedStudent?.class?.stream ? ` ${selectedStudent.class.stream}` : ""} (
                  {selectedStudent?.class?.year})
                </span>
              </div>

              {plansQ.isLoading ? (
                <div className="text-xs text-muted-foreground mt-2">Checking fee plans…</div>
              ) : !chosenPlan ? (
                <div className="mt-2 text-sm text-destructive">
                  No Fee Plan exists for this class/year/term. Create one in <b>Fee Plans</b> tab.
                </div>
              ) : (
                <div className="mt-2 text-sm">
                  Fee Plan found: <b>{chosenPlan.title || "Fee Plan"}</b>
                </div>
              )}
            </div>

            {/* Invoices */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Invoices</div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    disabled={
                      !canGenerateInvoice ||
                      !classId ||
                      genInvMut.isPending ||
                      isReadOnly ||
                      !chosenPlan
                    }
                    onClick={doGenerateInvoice}
                    title={!canGenerateInvoice ? "Only ADMIN can generate invoices" : undefined}
                  >
                    {genInvMut.isPending ? "Generating…" : "Generate Invoice"}
                  </Button>

                  {activeInvoice?.id && canVoidInvoice && (
                    <Button
                      variant="destructive"
                      disabled={voidMut.isPending || isReadOnly}
                      onClick={() => {
                        setVoidReason("");
                        setVoidOpen(true);
                      }}
                    >
                      Void Invoice
                    </Button>
                  )}
                </div>
              </div>

              <QueryBlock
                isLoading={invQ.isLoading}
                isError={invQ.isError}
                error={invQ.error}
                empty={!invQ.isLoading && invoices.length === 0}
                emptyText="No invoices yet for this term/year."
              >
                <div className="grid gap-2">
                  {invoices.map((inv) => {
                    const bal = toNumberOrZero(inv.balance);
                    const isActive = inv.id === (activeInvoice?.id || "");
                    const invNo = inv.invoiceNo || inv.id.slice(0, 6);
                    const voided = String(inv.status || "").toUpperCase() === "VOID";

                    return (
                      <div
                        key={inv.id}
                        className={`border rounded-md p-3 flex flex-wrap items-center justify-between gap-2 ${
                          isActive ? "bg-muted/30" : ""
                        }`}
                      >
                        <div className="min-w-[240px]">
                          <div className="text-sm font-medium">
                            Invoice #{invNo}{" "}
                            {voided && <span className="text-xs text-muted-foreground">(VOID)</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Total: {money(inv.total)} • Paid: {money(inv.paid)} • Balance:{" "}
                            <span className={bal > 0 ? "text-destructive" : ""}>{money(bal)}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => setSelectedInvoiceId(inv.id)}>
                            Select
                          </Button>
                          <Button
                            size="sm"
                            disabled={voided || bal <= 0 || isReadOnly}
                            onClick={() => startPay(inv)}
                            title={voided ? "Cannot pay a VOID invoice" : undefined}
                          >
                            Pay
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </QueryBlock>
            </div>

            {/* Payment form */}
            <div className="border rounded-md p-3 space-y-3">
              <div className="font-medium">Post payment</div>

              <div className="grid gap-2 md:grid-cols-6">
                <div className="md:col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Amount</div>
                  <Input
                    ref={amountRef}
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    disabled={isReadOnly || !activeInvoiceId || activeInvoiceIsVoid}
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Method</div>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    disabled={isReadOnly || !activeInvoiceId || activeInvoiceIsVoid}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Reference (optional)</div>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="MPESA code / Bank slip"
                    disabled={isReadOnly || !activeInvoiceId || activeInvoiceIsVoid}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Invoice:{" "}
                  <span className="font-medium">
                    {activeInvoice?.invoiceNo ||
                      (activeInvoice?.id ? activeInvoice.id.slice(0, 6) : "—")}
                  </span>
                </div>

                <Button
                  disabled={
                    payMut.isPending ||
                    isReadOnly ||
                    !activeInvoiceId ||
                    activeInvoiceIsVoid ||
                    toNumberOrZero(amount) <= 0
                  }
                  onClick={submitPayment}
                >
                  {payMut.isPending ? "Posting…" : "Post Payment"}
                </Button>
              </div>

              {!activeInvoiceId && (
                <div className="text-sm text-muted-foreground">Select an invoice or generate one first.</div>
              )}
              {activeInvoiceIsVoid && (
                <div className="text-sm text-destructive">This invoice is VOID. Payments are disabled.</div>
              )}
            </div>

            {/* Payments on selected invoice */}
            {activePayments.length > 0 && (
              <div className="space-y-2">
                <div className="font-medium">Payments on selected invoice</div>
                <div className="grid gap-2">
                  {activePayments.map((p) => (
                    <div
                      key={p.id}
                      className="border rounded-md p-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-[220px]">
                        <div className="text-sm font-medium">
                          {money(p.amount)}{" "}
                          <span className="text-muted-foreground">• {p.method}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Receipt: {p.receiptNo || "—"} •{" "}
                          {p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}
                        </div>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => printPaymentId(p.id)}>
                          Print / Save PDF
                        </Button>

                        {canReversePayment && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={reverseMut.isPending || isReadOnly || !!p.isReversed}
                            onClick={() => askReverse(p)}
                            title={p.isReversed ? "Already reversed" : undefined}
                          >
                            Reverse
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reverse modal */}
      <SimpleModal
        title="Reverse payment"
        open={reverseOpen}
        onClose={() => {
          setReverseOpen(false);
          setReverseReason("");
          setSelectedPaymentForReverse(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReverseOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reverseMut.isPending || isReadOnly || !reverseReason.trim()}
              onClick={confirmReverse}
            >
              {reverseMut.isPending ? "Reversing…" : "Confirm Reverse"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            This will mark the payment as reversed and restore balances.
          </div>
          <Input
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="Reason (required)"
          />
        </div>
      </SimpleModal>

      {/* Void modal */}
      <SimpleModal
        title="Void invoice"
        open={voidOpen}
        onClose={() => {
          setVoidOpen(false);
          setVoidReason("");
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidMut.isPending || isReadOnly || !voidReason.trim()}
              onClick={confirmVoid}
            >
              {voidMut.isPending ? "Voiding…" : "Confirm Void"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            This will void the selected invoice. Reverse payments first if any exist.
          </div>
          <Input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Reason (required)"
          />
        </div>
      </SimpleModal>
    </div>
  );
}
