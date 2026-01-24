// client/src/features/settings/logs/AuditLogsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

function fmtDate(v) {
  try {
    if (!v) return "-";
    return new Date(v).toLocaleString();
  } catch {
    return "-";
  }
}

function pickFilenameFromDisposition(disposition, fallback) {
  try {
    if (!disposition) return fallback;
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
    if (!m?.[1]) return fallback;
    return decodeURIComponent(m[1]);
  } catch {
    return fallback;
  }
}

async function getAuditLogs(params = {}) {
  const { data } = await api.get("/api/settings/audit-logs", { params });
  return data;
}

function clampStr(s, n = 48) {
  const x = String(s || "");
  if (x.length <= n) return x;
  return x.slice(0, n) + "…";
}

export default function AuditLogsTab() {
  const { data: meData } = useMe();
  const role = String(meData?.user?.role || "").toUpperCase();

  // Pagination
  const [take, setTake] = useState(50);
  const [cursor, setCursor] = useState(null);

  // Filters
  const [schoolId, setSchoolId] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");

  // Details viewer
  const [openDetails, setOpenDetails] = useState(false);
  const [selected, setSelected] = useState(null);

  const resetPaging = () => setCursor(null);

  const params = useMemo(() => {
    const p = { take, ...(cursor ? { cursor } : {}) };

    if (role === "SYSTEM_ADMIN" && schoolId.trim()) p.schoolId = schoolId.trim();
    if (category.trim()) p.category = category.trim();
    if (q.trim()) p.q = q.trim();

    if (action.trim()) p.action = action.trim();
    if (actorId.trim()) p.actorId = actorId.trim();
    if (targetType.trim()) p.targetType = targetType.trim();
    if (targetId.trim()) p.targetId = targetId.trim();

    return p;
  }, [take, cursor, role, schoolId, category, q, action, actorId, targetType, targetId]);

  const logsQ = useQuery({
    queryKey: ["settings-audit-logs", params],
    queryFn: () => getAuditLogs(params),
    retry: false,
    keepPreviousData: true,
  });

  const data = logsQ.data;
  const logs = data?.logs || [];
  const hasMore = !!data?.hasMore;
  const nextCursor = data?.nextCursor || null;

  const allowedCategories = data?.allowedCategories || [];

  const clearFilters = () => {
    setAction("");
    setActorId("");
    setTargetType("");
    setTargetId("");
    setCategory("");
    setQ("");
    if (role === "SYSTEM_ADMIN") setSchoolId("");
    resetPaging();
    logsQ.refetch();
  };

  const exportLogs = async (format) => {
    try {
      const exportParams = { ...params, format, take: 500 };
      delete exportParams.cursor;

      const res = await api.get("/api/settings/audit-logs", {
        params: exportParams,
        responseType: "blob",
      });

      const ext = format === "xlsx" ? "xlsx" : "csv";
      const fallback = `audit-logs.${ext}`;
      const filename = pickFilenameFromDisposition(res.headers?.["content-disposition"], fallback);

      const blob = new Blob([res.data], { type: res.headers?.["content-type"] || undefined });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("EXPORT AUDIT LOGS ERROR:", err);
      alert("Export failed. Check your network and backend export support.");
    }
  };

  const openRowDetails = (row) => {
    setSelected(row);
    setOpenDetails(true);
  };

  return (
    <div className="space-y-4 min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="font-medium">Audit Logs</div>

          <Badge variant="secondary" className="text-[10px] uppercase">
            {role || "—"}
          </Badge>

          <div className="text-sm text-muted-foreground min-w-0 truncate">
            Server-enforced scope • searchable • exportable
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start lg:justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => logsQ.refetch()}
            disabled={logsQ.isFetching}
            className="whitespace-nowrap"
          >
            {logsQ.isFetching ? "Refreshing…" : "Refresh"}
          </Button>

          <Button variant="outline" size="sm" onClick={() => exportLogs("csv")} className="whitespace-nowrap">
            Export CSV
          </Button>

          <Button variant="outline" size="sm" onClick={() => exportLogs("xlsx")} className="whitespace-nowrap">
            Export XLSX
          </Button>

          <Button variant="outline" size="sm" onClick={clearFilters} className="whitespace-nowrap">
            Clear filters
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3 min-w-0">
          <div className="text-sm font-medium">Filters</div>

          {role === "SYSTEM_ADMIN" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                placeholder="schoolId (SYSTEM_ADMIN only)"
                value={schoolId}
                onChange={(e) => {
                  setSchoolId(e.target.value);
                  resetPaging();
                }}
              />
              <div className="text-xs text-muted-foreground flex items-center">
                Tip: paste the schoolId to scope logs.
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 min-w-0">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                resetPaging();
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0"
            >
              <option value="">All categories</option>
              {allowedCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <Input
              placeholder="Search (q): action/email/target/id…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPaging();
              }}
            />

            <Input
              placeholder="action (exact match)"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                resetPaging();
              }}
            />

            <Input
              placeholder="actorId"
              value={actorId}
              onChange={(e) => {
                setActorId(e.target.value);
                resetPaging();
              }}
            />

            <Input
              placeholder="targetType"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value);
                resetPaging();
              }}
            />

            <Input
              placeholder="targetId"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                resetPaging();
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-muted-foreground">Rows:</div>
            {[25, 50, 100, 200].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={take === n ? "default" : "outline"}
                onClick={() => {
                  setTake(n);
                  resetPaging();
                }}
                className="whitespace-nowrap"
              >
                {n}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Body */}
      {logsQ.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading logs…</div>
      ) : logsQ.isError ? (
        <div className="text-sm text-destructive">
          Failed to load logs. Check backend route:{" "}
          <span className="font-medium">GET /api/settings/audit-logs</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No logs found for this filter.</div>
      ) : (
        <Card className="min-w-0">
          <CardContent className="p-0 min-w-0">
            {/* ✅ Table scrolls INSIDE card, not the whole page */}
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="sticky top-0 bg-background border-b z-10">
                  <tr className="text-left">
                    <th className="p-3 whitespace-nowrap">Time</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Actor</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">School</th>
                    <th className="p-3 w-[1%] whitespace-nowrap">More</th>
                  </tr>
                </thead>

                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b hover:bg-muted/40">
                      <td className="p-3 whitespace-nowrap">{fmtDate(l.createdAt)}</td>

                      <td className="p-3">
                        <div className="font-medium break-words">{l.action || "-"}</div>
                        {l.ip || l.userAgent ? (
                          <div className="text-xs text-muted-foreground">
                            {l.ip ? `IP: ${l.ip}` : null}
                            {l.ip && l.userAgent ? " • " : null}
                            {l.userAgent ? `UA: ${clampStr(l.userAgent, 56)}` : null}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3">
                        <div className="text-muted-foreground break-words">
                          {l.actorRole || "-"}
                          {l.actorEmail ? ` • ${l.actorEmail}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground break-all">{l.actorId || "-"}</div>
                      </td>

                      <td className="p-3">
                        <div className="text-muted-foreground break-words">{l.targetType || "-"}</div>
                        <div className="text-xs text-muted-foreground break-all">{l.targetId || "-"}</div>
                      </td>

                      <td className="p-3 text-muted-foreground break-all max-w-[220px]">
                        {l.schoolId || "-"}
                      </td>

                      <td className="p-3">
                        <Button size="sm" variant="outline" onClick={() => openRowDetails(l)} className="whitespace-nowrap">
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setCursor(null)} disabled={!cursor} className="whitespace-nowrap">
          First page
        </Button>

        <div className="text-xs text-muted-foreground">
          {logs.length} rows • {hasMore ? "More available" : "End"}
        </div>

        <Button size="sm" onClick={() => setCursor(nextCursor)} disabled={!hasMore || !nextCursor} className="whitespace-nowrap">
          Next
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        Tip: SYSTEM_ADMIN can filter by <span className="font-medium text-foreground">schoolId</span>. ADMIN scope is enforced automatically.
      </div>

      {/* Details Dialog */}
      <Dialog open={openDetails} onOpenChange={setOpenDetails}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
          </DialogHeader>

          {!selected ? (
            <div className="text-sm text-muted-foreground">No log selected.</div>
          ) : (
            <div className="space-y-3 min-w-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Time</div>
                  <div className="font-medium">{fmtDate(selected.createdAt)}</div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Action</div>
                  <div className="font-medium break-words">{selected.action || "-"}</div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Actor</div>
                  <div className="font-medium break-words">
                    {selected.actorEmail || selected.actorId || "-"}
                  </div>
                  <div className="text-xs text-muted-foreground">{selected.actorRole || "-"}</div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Target</div>
                  <div className="font-medium">{selected.targetType || "-"}</div>
                  <div className="text-xs text-muted-foreground break-all">{selected.targetId || "-"}</div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">School</div>
                  <div className="font-medium break-all">{selected.schoolId || "-"}</div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Client</div>
                  <div className="text-sm">
                    {selected.ip ? `IP: ${selected.ip}` : "IP: -"}
                    {selected.userAgent ? (
                      <div className="text-xs text-muted-foreground break-words mt-1">
                        UA: {String(selected.userAgent)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium">Metadata</div>
                <pre className="text-xs bg-muted/30 border rounded-lg p-3 overflow-auto max-h-[45vh]">
                  {JSON.stringify(selected.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDetails(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
