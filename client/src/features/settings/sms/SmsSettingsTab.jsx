// SMS to parents: switches, payment instructions, fee reminders, a message to
// classes, and the outbox showing what was sent.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listClasses } from "@/api/classes.api";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT = { SENT: "default", QUEUED: "secondary", FAILED: "destructive", SKIPPED: "outline" };
const KIND_LABEL = { PAYMENT: "Receipt", ABSENCE: "Absence", RESULTS: "Results", FEE_REMINDER: "Fee reminder", BROADCAST: "Message" };
const err = (e) => toast.error(e?.response?.data?.message || "Something went wrong");

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export default function SmsSettingsTab() {
  const qc = useQueryClient();
  const { currentYear } = useSchoolCalendar();
  const settingsQ = useQuery({ queryKey: ["smsSettings"], queryFn: () => api.get("/api/sms/settings").then((r) => r.data) });
  const [page, setPage] = useState(1);
  const outboxQ = useQuery({ queryKey: ["smsOutbox", page], queryFn: () => api.get("/api/sms/messages", { params: { page } }).then((r) => r.data) });
  const classesQ = useQuery({ queryKey: ["classes", { year: currentYear }], queryFn: () => listClasses({ year: currentYear }) });

  const save = useMutation({
    mutationFn: (patch) => api.patch("/api/sms/settings", patch).then((r) => r.data),
    onSuccess: (d) => qc.setQueryData(["smsSettings"], d),
    onError: err,
  });
  const s = settingsQ.data?.settings || {};
  const [instructions, setInstructions] = useState(null);

  const [minBalance, setMinBalance] = useState("1000");
  const [reminderPreview, setReminderPreview] = useState(null);
  const reminders = useMutation({
    mutationFn: (dryRun) => api.post("/api/sms/fee-reminders", { minBalance: Number(minBalance) || 1, dryRun }).then((r) => r.data),
    onSuccess: (d) => {
      if (d.dryRun) return setReminderPreview(d);
      setReminderPreview(null);
      toast.success(`${d.queued} reminder(s) queued`);
      qc.invalidateQueries({ queryKey: ["smsOutbox"] });
    },
    onError: err,
  });

  const [message, setMessage] = useState("");
  const [classIds, setClassIds] = useState([]);
  const [bcPreview, setBcPreview] = useState(null);
  const broadcast = useMutation({
    mutationFn: (dryRun) => api.post("/api/sms/broadcast", { message, classIds, dryRun }).then((r) => r.data),
    onSuccess: (d) => {
      if (d.dryRun) return setBcPreview(d);
      setBcPreview(null);
      setMessage("");
      toast.success(`${d.queued} message(s) queued`);
      qc.invalidateQueries({ queryKey: ["smsOutbox"] });
    },
    onError: err,
  });

  const on = !!s.smsEnabled;
  const outbox = outboxQ.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SMS to parents</CardTitle>
          <CardDescription>
            Messages go to each learner&apos;s primary parent (Parents &amp; guardians on the learner&apos;s profile).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsQ.data && !settingsQ.data.providerConfigured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              No SMS provider is set up on the server yet, so messages are recorded but not sent.
            </div>
          )}
          <Toggle label="Send SMS" checked={on} onChange={(v) => save.mutate({ smsEnabled: v })} />
          <div className="pl-6 space-y-2">
            <Toggle disabled={!on} label="Payment receipts" hint="When a payment is recorded: amount, receipt number and balance." checked={s.smsOnPayment} onChange={(v) => save.mutate({ smsOnPayment: v })} />
            <Toggle disabled={!on} label="Absence alerts" hint="When a register is submitted, for each learner marked absent." checked={s.smsOnAbsence} onChange={(v) => save.mutate({ smsOnAbsence: v })} />
            <Toggle disabled={!on} label="Results are out" hint="When exam results are published: average, grade and position." checked={s.smsOnResults} onChange={(v) => save.mutate({ smsOnResults: v })} />
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-64 space-y-1">
              <div className="text-sm font-medium">How to pay (added to fee reminders)</div>
              <Input
                placeholder="e.g. Pay via M-Pesa Paybill 123456, account = admission no."
                value={instructions ?? s.smsPaymentInstructions ?? ""}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <Button variant="outline" disabled={instructions == null} onClick={() => save.mutate({ smsPaymentInstructions: instructions })}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee reminders</CardTitle>
          <CardDescription>One SMS to the primary parent of each learner who owes at least this much (all terms, after credit).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Input aria-label="Minimum balance" type="number" className="w-36" value={minBalance} onChange={(e) => { setMinBalance(e.target.value); setReminderPreview(null); }} />
            {!reminderPreview ? (
              <Button variant="outline" disabled={!on || reminders.isPending} onClick={() => reminders.mutate(true)}>
                Preview
              </Button>
            ) : (
              <Button disabled={reminders.isPending || !reminderPreview.messages} onClick={() => reminders.mutate(false)}>
                Send {reminderPreview.messages} reminder(s)
              </Button>
            )}
          </div>
          {reminderPreview?.sample?.[0] && <div className="text-sm text-muted-foreground">e.g. “{reminderPreview.sample[0]}”</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message to parents</CardTitle>
          <CardDescription>Goes once to every parent phone in the chosen classes (all classes if none chosen).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            aria-label="Message"
            className="w-full min-h-20 rounded-md border bg-background p-2 text-sm"
            maxLength={400}
            placeholder="e.g. School closes on Friday at noon for half term."
            value={message}
            onChange={(e) => { setMessage(e.target.value); setBcPreview(null); }}
          />
          <div className="text-xs text-muted-foreground">{message.length}/400 · about {Math.max(1, Math.ceil((message.length + 20) / 153))} SMS each</div>
          <div className="flex flex-wrap gap-2">
            {(classesQ.data || []).map((c) => (
              <label key={c.id} className="text-sm flex items-center gap-1 border rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={classIds.includes(c.id)}
                  onChange={(e) => { setClassIds((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id))); setBcPreview(null); }}
                />
                {c.name}
                {c.stream ? ` ${c.stream}` : ""}
              </label>
            ))}
          </div>
          {!bcPreview ? (
            <Button variant="outline" disabled={!on || message.trim().length < 5 || broadcast.isPending} onClick={() => broadcast.mutate(true)}>
              Preview
            </Button>
          ) : (
            <Button disabled={broadcast.isPending || !bcPreview.recipients} onClick={() => broadcast.mutate(false)}>
              Send to {bcPreview.recipients} parent(s)
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sent messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {outboxQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !outbox?.items?.length ? (
            <div className="text-sm text-muted-foreground">No messages yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {outbox.items.map((m) => (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">{new Date(m.createdAt).toLocaleString("en-KE")}</td>
                      <td className="p-2 whitespace-nowrap">{KIND_LABEL[m.kind] || m.kind}</td>
                      <td className="p-2 whitespace-nowrap">{m.to}</td>
                      <td className="p-2">{m.body}</td>
                      <td className="p-2">
                        <Badge variant={STATUS_VARIANT[m.status]} title={m.error || undefined}>
                          {m.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {outbox?.total > 50 && (
            <div className="flex justify-between">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <Button size="sm" variant="outline" disabled={page * 50 >= outbox.total} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
