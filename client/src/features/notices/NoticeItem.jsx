import { dateIn } from "@/lib/schoolCalendar";
import { Badge } from "@/components/ui/badge";
import { AUDIENCE_LABEL } from "./notices.api";

/** One notice, as everyone sees it. */
export default function NoticeItem({ n, classNames, timezone, children }) {
  const expired = n.expiresAt && new Date(n.expiresAt) < new Date();
  return (
    <div className="border-b last:border-b-0 py-3 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{n.title}</span>
        {n.pinned && <Badge variant="secondary">Pinned</Badge>}
        {expired && <Badge variant="outline">Expired</Badge>}
      </div>
      <div className="text-sm whitespace-pre-line">{n.body}</div>
      <div className="text-xs text-muted-foreground">
        {dateIn(n.createdAt, timezone)}
        {classNames && (
          <>
            {" · "}
            {AUDIENCE_LABEL[n.audience]}
            {n.classIds?.length ? ` (${n.classIds.map((id) => classNames.get(id) || "a removed class").join(", ")})` : ""}
            {n.expiresAt ? ` · until ${dateIn(n.expiresAt, timezone)}` : ""}
            {n.smsQueued ? ` · texted to ${n.smsQueued} parent${n.smsQueued === 1 ? "" : "s"}` : ""}
          </>
        )}
      </div>
      {children}
    </div>
  );
}
