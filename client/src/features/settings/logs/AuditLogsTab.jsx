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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Audit Logs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Server-enforced audit trail with search and export
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {role}
          </Badge>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => logsQ.refetch()}
          disabled={logsQ.isFetching}
          size="sm"
        >
          {logsQ.isFetching ? "Refreshing..." : "Refresh"}
        </Button>

        <Button variant="outline" onClick={() => exportLogs("csv")} size="sm">
          Export CSV
        </Button>

        <Button variant="outline" onClick={() => exportLogs("xlsx")} size="sm">
          Export Excel
        </Button>

        <Button variant="outline" onClick={clearFilters} size="sm">
          Clear Filters
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <h3 className="font-medium">Filters</h3>
            
            {role === "SYSTEM_ADMIN" && (
              <div className="space-y-2">
                <div className="text-sm font-medium">School Scope (SYSTEM_ADMIN only)</div>
                <Input
                  placeholder="Enter school ID to scope logs"
                  value={schoolId}
                  onChange={(e) => {
                    setSchoolId(e.target.value);
                    resetPaging();
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">Category</div>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    resetPaging();
                  }}
                  className="w-full border rounded-md h-10 px-3 bg-background text-sm"
                >
                  <option value="">All Categories</option>
                  {allowedCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Search</div>
                <Input
                  placeholder="Search across all fields"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    resetPaging();
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Action</div>
                <Input
                  placeholder="Filter by action"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    resetPaging();
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Actor ID</div>
                <Input
                  placeholder="Filter by actor ID"
                  value={actorId}
                  onChange={(e) => {
                    setActorId(e.target.value);
                    resetPaging();
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Target Type</div>
                <Input
                  placeholder="Filter by target type"
                  value={targetType}
                  onChange={(e) => {
                    setTargetType(e.target.value);
                    resetPaging();
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Target ID</div>
                <Input
                  placeholder="Filter by target ID"
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    resetPaging();
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Rows per page</div>
              <div className="flex gap-2">
                {[25, 50, 100, 200].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={take === n ? "default" : "outline"}
                    onClick={() => {
                      setTake(n);
                      resetPaging();
                    }}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {logsQ.isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">Loading audit logs...</div>
          </CardContent>
        </Card>
      ) : logsQ.isError ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Failed to load logs</div>
            <div className="text-muted-foreground mb-4">
              Check backend route: GET /api/settings/audit-logs
            </div>
            <Button onClick={() => logsQ.refetch()}>Try Again</Button>
          </CardContent>
        </Card>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">No logs found</div>
            <div className="text-muted-foreground">
              Try adjusting your filters or check if logs exist for the selected scope.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Time</th>
                    <th className="p-3 font-medium">Action</th>
                    <th className="p-3 font-medium">Actor</th>
                    <th className="p-3 font-medium">Target</th>
                    <th className="p-3 font-medium">School</th>
                    <th className="p-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <div className="whitespace-nowrap">{fmtDate(l.createdAt)}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{l.action || "-"}</div>
                        {(l.ip || l.userAgent) && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {l.ip && <div>IP: {l.ip}</div>}
                            {l.userAgent && (
                              <div className="truncate max-w-[200px]" title={l.userAgent}>
                                UA: {l.userAgent}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div>{l.actorRole || "-"}</div>
                        {l.actorEmail && (
                          <div className="text-xs text-muted-foreground">{l.actorEmail}</div>
                        )}
                        {l.actorId && (
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                            ID: {l.actorId}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div>{l.targetType || "-"}</div>
                        {l.targetId && (
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                            ID: {l.targetId}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="truncate max-w-[150px]">{l.schoolId || "-"}</div>
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRowDetails(l)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {logs.length} log{logs.length !== 1 ? 's' : ''}
              {hasMore && " • More available"}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor(null)}
                disabled={!cursor}
              >
                First Page
              </Button>
              <Button
                size="sm"
                onClick={() => setCursor(nextCursor)}
                disabled={!hasMore || !nextCursor}
              >
                Next Page
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Details Dialog */}
      <Dialog open={openDetails} onOpenChange={setOpenDetails}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium mb-2">Basic Information</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Time</div>
                      <div>{fmtDate(selected.createdAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Action</div>
                      <div className="font-medium">{selected.action || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">School</div>
                      <div>{selected.schoolId || "-"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Client Information</div>
                  <div className="space-y-2">
                    {selected.ip && (
                      <div>
                        <div className="text-xs text-muted-foreground">IP Address</div>
                        <div>{selected.ip}</div>
                      </div>
                    )}
                    {selected.userAgent && (
                      <div>
                        <div className="text-xs text-muted-foreground">User Agent</div>
                        <div className="text-sm break-words">{selected.userAgent}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Actor Information</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Role</div>
                      <div>{selected.actorRole || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Email</div>
                      <div>{selected.actorEmail || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">ID</div>
                      <div className="font-mono text-sm">{selected.actorId || "-"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Target Information</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Type</div>
                      <div>{selected.targetType || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">ID</div>
                      <div className="font-mono text-sm">{selected.targetId || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Metadata</div>
                <pre className="text-sm bg-muted/20 p-3 rounded-md overflow-auto max-h-[40vh]">
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