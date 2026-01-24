import { useState } from "react";

import { openReceiptPdf } from "@/api/fees.api";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { money } from "../components/FeeMoney";

function getInitialLastReceipt() {
  try {
    return JSON.parse(localStorage.getItem("fees:lastReceipt") || "null");
  } catch {
    return null;
  }
}

export default function PaymentsTab() {
  // This is populated by Cashier tab after successful payment
  const [lastReceipt, setLastReceipt] = useState(() => getInitialLastReceipt());

  // Optional: allow searching by paymentId to reprint (admin/audit convenience)
  const [paymentId, setPaymentId] = useState("");

  const clearReceipt = () => {
    setLastReceipt(null);
    localStorage.removeItem("fees:lastReceipt");
  };

  const printById = () => {
    const id = paymentId.trim();
    if (!id) return;
    openReceiptPdf(id);
  };

  return (
    <div className="space-y-4">
      {/* Info / guidance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <div>
            This tab is for <span className="font-medium text-foreground">viewing and reprinting receipts</span>.
          </div>
          <div>
            To post a payment, use the <span className="font-medium text-foreground">Receive Payment</span> tab
            (Cashier flow). That’s where invoices are selected and balances are updated correctly.
          </div>
        </CardContent>
      </Card>

      {/* Quick reprint by Payment ID (optional helper) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reprint receipt</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-6 items-end">
          <div className="md:col-span-4">
            <div className="text-xs text-muted-foreground mb-1">Payment ID</div>
            <Input
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
              placeholder="Paste paymentId then print receipt"
            />
          </div>

          <div className="md:col-span-2 flex gap-2 justify-end">
            <Button variant="outline" onClick={printById} disabled={!paymentId.trim()}>
              Print Receipt (PDF)
            </Button>
            <Button variant="ghost" onClick={() => setPaymentId("")} disabled={!paymentId.trim()}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Last receipt (from cashier) */}
      {lastReceipt?.paymentId ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span>Last receipt</span>
              <Badge variant="secondary">{lastReceipt.method || "—"}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm">
              Receipt: <span className="font-semibold">{lastReceipt.receiptNo || "—"}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Amount: <span className="font-medium">{money(lastReceipt.amount || 0)}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openReceiptPdf(lastReceipt.paymentId)}>
                Print Receipt (PDF)
              </Button>
              <Button variant="ghost" onClick={clearReceipt}>
                Clear Receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            No recent receipt saved. Post a payment in <span className="font-medium text-foreground">Receive Payment</span>{" "}
            to generate one.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
