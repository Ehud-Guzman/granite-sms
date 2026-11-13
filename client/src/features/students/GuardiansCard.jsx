// Parents / guardians on the student profile. Admins add, edit and remove;
// teachers (own classes) see contacts. A parent already in the school with the
// same phone is linked rather than duplicated, so siblings share one record.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Star, Trash2 } from "lucide-react";

import { api } from "@/api/axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { confirmAction } from "@/lib/confirm-store";

const RELATIONSHIPS = [
  ["MOTHER", "Mother"],
  ["FATHER", "Father"],
  ["GUARDIAN", "Guardian"],
  ["SPONSOR", "Sponsor"],
  ["OTHER", "Other"],
];
const relLabel = (r) => RELATIONSHIPS.find(([v]) => v === r)?.[1] || r;
const EMPTY = { firstName: "", lastName: "", phone: "", email: "", relationship: "MOTHER" };

const listGuardians = (studentId) =>
  api.get(`/api/guardians/student/${studentId}`).then((r) => r.data?.guardians || []);

export default function GuardiansCard({ studentId, canEdit }) {
  const qc = useQueryClient();
  const key = ["studentGuardians", studentId];
  const q = useQuery({ queryKey: key, queryFn: () => listGuardians(studentId), enabled: !!studentId });

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const done = (data, msg) => {
    qc.setQueryData(key, data.guardians);
    if (msg) toast.success(msg);
  };
  const fail = (err) => toast.error(err?.response?.data?.message || "Could not save");

  const addMut = useMutation({
    mutationFn: () => api.post(`/api/guardians/student/${studentId}`, form).then((r) => r.data),
    onSuccess: (data) => {
      done(data, data.linkedExisting ? "Linked to an existing parent with that phone number" : "Guardian added");
      setForm(EMPTY);
      setAdding(false);
    },
    onError: fail,
  });
  const primaryMut = useMutation({
    mutationFn: (linkId) => api.patch(`/api/guardians/links/${linkId}`, { isPrimary: true }).then((r) => r.data),
    onSuccess: (d) => done(d, "Primary contact changed"),
    onError: fail,
  });
  const removeMut = useMutation({
    mutationFn: (linkId) => api.delete(`/api/guardians/links/${linkId}`).then((r) => r.data),
    onSuccess: (d) => done(d, "Guardian removed from this student"),
    onError: fail,
  });

  // A parent portal login: shown once here (and texted if the school has SMS on).
  const [issued, setIssued] = useState(null);
  const loginMut = useMutation({
    mutationFn: ({ guardianId, sendSms }) => api.post(`/api/guardians/${guardianId}/login`, { sendSms }).then((r) => r.data),
    onSuccess: (d) => {
      setIssued(d);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: fail,
  });

  const guardians = q.data || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Parents &amp; guardians</CardTitle>
          <CardDescription>Who to call about this learner. The primary contact is called first.</CardDescription>
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add guardian
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : q.isError ? (
          <div className="text-sm text-destructive">Failed to load guardians.</div>
        ) : guardians.length === 0 && !adding ? (
          <div className="text-sm text-muted-foreground">
            No parent or guardian recorded yet{canEdit ? ". Add one so the school can reach the family." : "."}
          </div>
        ) : (
          guardians.map((g) => (
            <div key={g.linkId} className="rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1 min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {g.guardian.firstName} {g.guardian.lastName}
                  <Badge variant="outline">{relLabel(g.relationship)}</Badge>
                  {g.isPrimary && <Badge>Primary contact</Badge>}
                  {g.guardian.userId && <Badge variant="secondary">Has parent login</Badge>}
                </div>
                <a href={`tel:${g.guardian.phone}`} className="text-sm inline-flex items-center gap-1 text-primary">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {g.guardian.phone}
                </a>
                {g.guardian.email && <div className="text-sm text-muted-foreground">{g.guardian.email}</div>}
                {g.otherChildren?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Also parent of: {g.otherChildren.map((c) => `${c.firstName} ${c.lastName} (${c.admissionNo})`).join(", ")}
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-2 shrink-0">
                  {!g.guardian.userId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loginMut.isPending}
                      onClick={async () => {
                        const sendSms = await confirmAction({
                          title: "Create a parent login?",
                          description: `${g.guardian.firstName} will sign in with ${g.guardian.email || g.guardian.phone} and a temporary password. Text the password to ${g.guardian.phone}? (Choose Cancel to only show it here.)`,
                          confirmLabel: "Create and text it",
                        });
                        loginMut.mutate({ guardianId: g.guardian.id, sendSms });
                      }}
                    >
                      Create parent login
                    </Button>
                  )}
                  {!g.isPrimary && (
                    <Button size="sm" variant="outline" disabled={primaryMut.isPending} onClick={() => primaryMut.mutate(g.linkId)}>
                      <Star className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                      Make primary
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Remove ${g.guardian.firstName} ${g.guardian.lastName}`}
                    disabled={removeMut.isPending}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: "Remove guardian?",
                        description: `${g.guardian.firstName} ${g.guardian.lastName} will no longer be listed for this learner.`,
                        confirmLabel: "Remove",
                        variant: "destructive",
                      });
                      if (ok) removeMut.mutate(g.linkId);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}

        {issued && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-1">
            <div className="font-medium">Parent login created</div>
            <div>
              Sign in with: <b>{issued.loginId}</b>
            </div>
            <div>
              Temporary password: <code className="bg-muted px-1 rounded">{issued.tempPassword}</code>
            </div>
            <div className="text-xs text-muted-foreground">
              {issued.smsQueued ? "Also sent by SMS. " : ""}It is shown only once; they will be asked to change it.
            </div>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        )}

        {adding && (
          <form
            className="rounded-md border p-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              addMut.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="g-first">First name</Label>
              <Input id="g-first" value={form.firstName} onChange={set("firstName")} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-last">Last name</Label>
              <Input id="g-last" value={form.lastName} onChange={set("lastName")} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-phone">Phone</Label>
              <Input id="g-phone" type="tel" inputMode="tel" placeholder="0712 345 678" value={form.phone} onChange={set("phone")} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-rel">Relationship</Label>
              <select
                id="g-rel"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.relationship}
                onChange={set("relationship")}
              >
                {RELATIONSHIPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="g-email">Email (optional)</Label>
              <Input id="g-email" type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addMut.isPending}>
                {addMut.isPending ? "Saving…" : "Save guardian"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
