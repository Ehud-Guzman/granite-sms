// The school noticeboard. Everyone reads the notices meant for them; admins
// post, pin, edit and remove them, and can text family notices to parents.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listClasses } from "@/api/classes.api";
import { useMe } from "@/hooks/useMe";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { confirmAction } from "@/lib/confirm-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUDIENCE_LABEL, useNotices } from "./notices.api";
import NoticeItem from "./NoticeItem";

const classLabel = (c) => `${c.name}${c.stream ? ` ${c.stream}` : ""}`;
const errMsg = (e, fallback) => e?.response?.data?.message || fallback;

const empty = { title: "", body: "", audience: "EVERYONE", classIds: [], pinned: false, expiresOn: "", sendSms: false };

function Composer({ classes, onDone }) {
  const [f, setF] = useState(empty);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const families = f.audience === "FAMILIES";
  const canText = f.audience !== "STAFF";

  const save = useMutation({
    mutationFn: () =>
      api
        .post("/api/notices", {
          title: f.title,
          body: f.body,
          audience: f.audience,
          classIds: families ? f.classIds : [],
          pinned: f.pinned,
          expiresOn: f.expiresOn || null,
          sendSms: canText && f.sendSms,
        })
        .then((r) => r.data),
    onSuccess: (d) => {
      if (d.smsQueued) toast.success(`Notice posted and texted to ${d.smsQueued} parent${d.smsQueued === 1 ? "" : "s"}`);
      else toast.success("Notice posted");
      if (d.smsQueued && !d.providerConfigured) toast.message("No SMS provider is set up, so the texts were not sent (see the SMS outbox).");
      setF(empty);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "Could not post the notice")),
  });

  const toggleClass = (id) =>
    setF((x) => ({ ...x, classIds: x.classIds.includes(id) ? x.classIds.filter((c) => c !== id) : [...x.classIds, id] }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Post a notice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Input aria-label="Title" placeholder="Title, e.g. Half-term break" value={f.title} maxLength={120} onChange={(e) => set("title")(e.target.value)} />
        <textarea
          aria-label="Notice"
          placeholder="What do people need to know?"
          className="w-full min-h-28 rounded-md border bg-background px-3 py-2 text-sm"
          value={f.body}
          maxLength={4000}
          onChange={(e) => set("body")(e.target.value)}
        />
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2">
            For
            <select aria-label="Audience" className="h-9 rounded-md border bg-background px-3" value={f.audience} onChange={(e) => set("audience")(e.target.value)}>
              {Object.entries(AUDIENCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Show until
            <Input aria-label="Show until" type="date" className="w-40" value={f.expiresOn} onChange={(e) => set("expiresOn")(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.pinned} onChange={(e) => set("pinned")(e.target.checked)} />
            Pin to the top
          </label>
          {canText && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.sendSms} onChange={(e) => set("sendSms")(e.target.checked)} />
              Also text parents
            </label>
          )}
        </div>
        {families && (
          <div className="space-y-1">
            <div className="text-muted-foreground">Classes (leave all unticked for the whole school)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={f.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                  {classLabel(c)}
                </label>
              ))}
            </div>
          </div>
        )}
        {canText && f.sendSms && (
          <div className="text-xs text-muted-foreground">
            Parents get one text each: the title and the start of the notice. Long notices are cut short and point to the portal.
          </div>
        )}
        <div className="flex justify-end">
          <Button disabled={save.isPending || f.title.trim().length < 3 || !f.body.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Posting…" : "Post notice"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminActions({ n, onChanged }) {
  const patch = useMutation({
    mutationFn: (data) => api.patch(`/api/notices/${n.id}`, data),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e, "Could not update the notice")),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/notices/${n.id}`),
    onSuccess: () => {
      toast.success("Notice removed");
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e, "Could not remove the notice")),
  });
  return (
    <div className="flex gap-2 pt-1">
      <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ pinned: !n.pinned })}>
        {n.pinned ? "Unpin" : "Pin"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={remove.isPending}
        onClick={async () => {
          if (await confirmAction({ title: "Remove this notice?", description: n.title, confirmLabel: "Remove", variant: "destructive" })) remove.mutate();
        }}
      >
        Remove
      </Button>
    </div>
  );
}

export default function NoticesPage() {
  const qc = useQueryClient();
  const meQ = useMe();
  const isAdmin = meQ.data?.user?.role === "ADMIN";
  const { timezone } = useSchoolCalendar();
  const [showExpired, setShowExpired] = useState(false);
  const q = useNotices({ all: isAdmin && showExpired });
  const classesQ = useQuery({ queryKey: ["classes", { all: true }], queryFn: () => listClasses(), enabled: isAdmin });
  const classes = classesQ.data || [];
  const classNames = isAdmin ? new Map(classes.map((c) => [c.id, classLabel(c)])) : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notices"] });
  const notices = q.data || [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Notices</h1>
        <p className="text-muted-foreground text-sm">News and reminders from the school.</p>
      </div>

      {isAdmin && <Composer classes={classes} onDone={refresh} />}

      <Card>
        <CardHeader className="pb-0 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{isAdmin ? "All notices" : "For you"}</CardTitle>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm font-normal">
              <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
              Show expired
            </label>
          )}
        </CardHeader>
        <CardContent>
          {q.isLoading && <div className="py-3 text-sm text-muted-foreground">Loading…</div>}
          {q.isError && <div className="py-3 text-sm text-destructive">Couldn&apos;t load notices.</div>}
          {!q.isLoading && !q.isError && notices.length === 0 && <div className="py-3 text-sm text-muted-foreground">No notices right now.</div>}
          {notices.map((n) => (
            <NoticeItem key={n.id} n={n} classNames={classNames} timezone={timezone}>
              {isAdmin && <AdminActions n={n} onChanged={refresh} />}
            </NoticeItem>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
