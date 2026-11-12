// M-Pesa: payments that arrived on the paybill, the ones whose account number
// didn't match a learner (assign them), and the paybill set-up (admins).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import StudentLookupByAdmission from "../components/StudentLookupByAdmission";
import { money } from "../components/FeeMoney";

const err = (e) => toast.error(e?.response?.data?.message || "Something went wrong");
const when = (d) => (d ? new Date(d).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—");

function Unmatched() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mpesa", "UNMATCHED"], queryFn: () => api.get("/api/mpesa/transactions", { params: { status: "UNMATCHED" } }).then((r) => r.data.items) });
  const [assigning, setAssigning] = useState(null);
  const assign = useMutation({
    mutationFn: ({ id, studentId }) => api.post(`/api/mpesa/transactions/${id}/assign`, { studentId }),
    onSuccess: () => {
      toast.success("Payment put on the learner's account");
      setAssigning(null);
      qc.invalidateQueries({ queryKey: ["mpesa"] });
      qc.invalidateQueries({ queryKey: ["feeInvoices"] });
    },
    onError: err,
  });
  const items = q.data || [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Needs a learner {items.length > 0 && <Badge variant="destructive" className="ml-2">{items.length}</Badge>}
        </CardTitle>
        <CardDescription>The account number didn&apos;t match an admission number. Find the learner and assign it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {q.isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">Nothing waiting.</div>
        ) : (
          items.map((t) => (
            <div key={t.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <b>{money(t.amount)}</b> · {t.transId} · account typed: <b>{t.billRef || "—"}</b>
                </div>
                <div className="text-muted-foreground">
                  {t.payerName || ""} {t.msisdn || ""} · {when(t.transTime)}
                </div>
              </div>
              {assigning === t.id ? (
                <StudentLookupByAdmission
                  onSelect={(student) => assign.mutate({ id: t.id, studentId: student.id })}
                />
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAssigning(t.id)}>
                  Assign to a learner
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Recent() {
  const q = useQuery({ queryKey: ["mpesa", "recent"], queryFn: () => api.get("/api/mpesa/transactions").then((r) => r.data.items) });
  const items = (q.data || []).slice(0, 30);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recent M-Pesa payments</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">None yet.</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2 whitespace-nowrap text-muted-foreground">{when(t.transTime)}</td>
                  <td className="p-2">{t.transId}</td>
                  <td className="p-2">{t.billRef || "—"}</td>
                  <td className="p-2 text-right">{money(t.amount)}</td>
                  <td className="p-2">
                    <Badge variant={t.status === "UNMATCHED" ? "destructive" : "outline"}>{t.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Setup() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mpesaConfig"], queryFn: () => api.get("/api/mpesa/config").then((r) => r.data) });
  const c = q.data?.config;
  const [form, setForm] = useState({});
  const val = (k, d = "") => form[k] ?? c?.[k] ?? d;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      api.put("/api/mpesa/config", {
        shortcode: val("shortcode"),
        kind: val("kind", "PAYBILL"),
        environment: val("environment", "sandbox"),
        consumerKey: form.consumerKey || undefined,
        consumerSecret: form.consumerSecret || undefined,
        passkey: form.passkey || undefined,
      }),
    onSuccess: () => {
      toast.success("M-Pesa set-up saved");
      setForm({});
      qc.invalidateQueries({ queryKey: ["mpesaConfig"] });
    },
    onError: err,
  });
  const register = useMutation({
    mutationFn: () => api.post("/api/mpesa/register-urls"),
    onSuccess: () => {
      toast.success("Safaricom will now send this paybill's payments here");
      qc.invalidateQueries({ queryKey: ["mpesaConfig"] });
    },
    onError: err,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Paybill set-up</CardTitle>
        <CardDescription>
          From your Daraja app (developer.safaricom.co.ke). Parents pay with the learner&apos;s admission number as the account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.data && !q.data.serverReady && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The server isn&apos;t ready for M-Pesa yet (MPESA_ENC_KEY and PUBLIC_API_URL). See docs/MPESA.md.
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Paybill or till number" placeholder="Paybill / till number" value={val("shortcode")} onChange={set("shortcode")} />
          <select aria-label="Type" className="h-9 rounded-md border bg-background px-2" value={val("kind", "PAYBILL")} onChange={set("kind")}>
            <option value="PAYBILL">Paybill</option>
            <option value="TILL">Till (Buy Goods)</option>
          </select>
          <select aria-label="Environment" className="h-9 rounded-md border bg-background px-2" value={val("environment", "sandbox")} onChange={set("environment")}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Live</option>
          </select>
          <Input aria-label="Consumer key" placeholder={c?.hasConsumerKey ? "Consumer key (saved)" : "Consumer key"} value={form.consumerKey || ""} onChange={set("consumerKey")} />
          <Input aria-label="Consumer secret" type="password" placeholder={c?.hasConsumerSecret ? "Consumer secret (saved)" : "Consumer secret"} value={form.consumerSecret || ""} onChange={set("consumerSecret")} />
          <Input aria-label="Passkey" type="password" placeholder={c?.hasPasskey ? "Passkey (saved)" : "Passkey (for payment prompts)"} value={form.passkey || ""} onChange={set("passkey")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!val("shortcode") || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
          <Button variant="outline" disabled={!c || register.isPending} onClick={() => register.mutate()}>
            Connect paybill to Granite
          </Button>
          {c?.urlsRegisteredAt && <span className="self-center text-muted-foreground">Connected {when(c.urlsRegisteredAt)}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MpesaTab({ isAdmin }) {
  return (
    <div className="grid gap-3">
      <Unmatched />
      <Recent />
      {isAdmin && <Setup />}
    </div>
  );
}
