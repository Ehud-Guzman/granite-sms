// client/src/features/settings/backup/BackupsRestoreTab.jsx
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/axios";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  const variant =
    s === "READY" ? "secondary" : s === "FAILED" ? "destructive" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase">
      {s || "—"}
    </Badge>
  );
}

function TypeBadge({ type }) {
  const t = String(type || "").toUpperCase();
  return (
    <Badge variant="outline" className="text-[10px] uppercase">
      {t || "—"}
    </Badge>
  );
}

async function listBackups({ schoolId }) {
  const { data } = await api.get("/api/settings/backup", {
    params: schoolId ? { schoolId } : undefined,
  });
  return data?.backups ?? data;
}

async function createBackup({ schoolId }) {
  const { data } = await api.post("/api/settings/backup/create", null, {
    params: schoolId ? { schoolId } : undefined,
  });
  return data;
}

async function previewBackup({ id }) {
  const { data } = await api.get(`/api/settings/backup/${id}/preview`);
  return data?.backup ?? data;
}

async function restoreBackup({ id, payload }) {
  const { data } = await api.post(`/api/settings/backup/${id}/restore`, payload);
  return data;
}

function downloadUrl(id) {
  // axios baseURL is already set, but for direct download we can hit relative path
  return `/api/settings/backup/${id}/download`;
}

/**
 * NOTE:
 * These endpoints are SYSTEM_ADMIN-only in your backend.
 * So this tab is primarily for SYSTEM_ADMIN.
 */
export default function BackupsRestoreTab() {
  const qc = useQueryClient();

  // SYSTEM_ADMIN scope selector (works with your resolveSchoolScope)
  const [schoolId, setSchoolId] = useState("school_demo_001");

  // lightweight dialogs state
  const [previewId, setPreviewId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [restoreId, setRestoreId] = useState(null);
  const [restoreMode, setRestoreMode] = useState("MERGE"); // MERGE | REPLACE
  const [confirmText, setConfirmText] = useState("");

  const listQ = useQuery({
    queryKey: ["backups", schoolId],
    queryFn: () => listBackups({ schoolId }),
    retry: false,
  });

  const createM = useMutation({
    mutationFn: () => createBackup({ schoolId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups", schoolId] });
    },
  });

  const previewM = useMutation({
    mutationFn: ({ id }) => previewBackup({ id }),
    onSuccess: (data) => setPreview(data),
  });

  const restoreM = useMutation({
    mutationFn: ({ id, payload }) => restoreBackup({ id, payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups", schoolId] });
    },
  });

  const backups = useMemo(() => listQ.data?.backups ?? listQ.data ?? [], [listQ.data]);

  // --- UI helpers ---
  const canCreate = !createM.isPending;
  const canRestore = !restoreM.isPending;

  const restorePayload = () => {
    const payload = { mode: restoreMode };
    // your backend allows targetSchoolId optional (defaults to backup’s school)
    if (schoolId?.trim()) payload.targetSchoolId = schoolId.trim();

    if (restoreMode === "REPLACE") {
      payload.confirm = confirmText;
    }
    return payload;
  };

  // --- Render ---
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
         
          <div className="text-sm text-muted-foreground">
            Tenant snapshots for disaster recovery. SYSTEM_ADMIN scope.
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            placeholder="schoolId (SYSTEM_ADMIN)"
            className="h-9 w-[220px]"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => listQ.refetch()}
            disabled={listQ.isLoading}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => createM.mutate()}
            disabled={!canCreate}
          >
            {createM.isPending ? "Creating…" : "Create Backup"}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Errors */}
      {listQ.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive space-y-1">
            <div>Failed to load backups.</div>
            <div className="text-muted-foreground">
              If you’re not SYSTEM_ADMIN, backend will return 403.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {createM.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            Failed to create backup.
          </CardContent>
        </Card>
      ) : null}

      {/* List */}
      <div className="divide-y rounded-lg border bg-background">
        {listQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading backups…</div>
        ) : backups.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No backups yet.</div>
        ) : (
          backups.map((b) => (
            <div key={b.id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium truncate">{b.id}</div>
                  <StatusBadge status={b.status} />
                  <TypeBadge type={b.type} />
                  <Badge variant="outline" className="text-[10px]">
                    {b.schoolId || "platform"}
                  </Badge>
                </div>

                <div className="text-xs text-muted-foreground mt-1">
                  Created: <span className="font-medium">{fmtDate(b.createdAt)}</span>
                  {b?.meta?.counts ? (
                    <>
                      {" "}
                      • Counts:{" "}
                      <span className="font-medium">
                        U:{b.meta.counts.users ?? 0} • T:{b.meta.counts.teachers ?? 0} • C:{b.meta.counts.classes ?? 0} • S:{b.meta.counts.students ?? 0}
                      </span>
                    </>
                  ) : null}
                </div>

                {b?.meta?.notes ? (
                  <div className="text-xs text-muted-foreground mt-1">
                    Notes: {b.meta.notes}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPreviewId(b.id);
                    setPreview(null);
                    previewM.mutate({ id: b.id });
                  }}
                  disabled={previewM.isPending}
                >
                  Preview
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // open download in new tab
                    window.open(downloadUrl(b.id), "_blank");
                  }}
                >
                  Download
                </Button>

                <Button
                  size="sm"
                  onClick={() => {
                    setRestoreId(b.id);
                    setRestoreMode("MERGE");
                    setConfirmText("");
                  }}
                >
                  Restore
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Preview panel */}
      {previewId ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">Backup Preview</div>
              <Button size="sm" variant="outline" onClick={() => { setPreviewId(null); setPreview(null); }}>
                Close
              </Button>
            </div>

            {previewM.isPending ? (
              <div className="text-sm text-muted-foreground">Loading preview…</div>
            ) : preview ? (
              <div className="text-sm space-y-1">
                <div>ID: <span className="font-medium">{preview.id}</span></div>
                <div>Status: <span className="font-medium">{preview.status}</span></div>
                <div>School: <span className="font-medium">{preview.schoolId || "platform"}</span></div>
                <div>Created: <span className="font-medium">{fmtDate(preview.createdAt)}</span></div>
                {preview?.meta?.counts ? (
                  <div className="text-xs text-muted-foreground">
                    Snapshot counts: {JSON.stringify(preview.meta.counts)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No preview data.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Restore panel */}
      {restoreId ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">Restore Backup</div>
              <Button size="sm" variant="outline" onClick={() => setRestoreId(null)}>
                Close
              </Button>
            </div>

            <div className="text-sm text-muted-foreground">
              Restore target school: <span className="font-medium">{schoolId || "backup default"}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={restoreMode === "MERGE" ? "default" : "outline"}
                onClick={() => { setRestoreMode("MERGE"); setConfirmText(""); }}
              >
                MERGE (safe)
              </Button>
              <Button
                size="sm"
                variant={restoreMode === "REPLACE" ? "destructive" : "outline"}
                onClick={() => setRestoreMode("REPLACE")}
              >
                REPLACE (wipe then restore)
              </Button>
            </div>

            {restoreMode === "REPLACE" ? (
              <div className="space-y-2">
                <div className="text-sm text-destructive">
                  REPLACE will delete tenant data first. Type the confirmation phrase to proceed:
                </div>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder='Type: DELETE SCHOOL DATA'
                />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                MERGE restores safe pieces without wiping existing data. Ideal for recovery and patch restores.
              </div>
            )}

            {restoreM.isError ? (
              <div className="text-sm text-destructive">
                Restore failed. Check server logs (backup might be FAILED / not READY).
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                onClick={() => restoreM.mutate({ id: restoreId, payload: restorePayload() })}
                disabled={
                  !canRestore ||
                  (restoreMode === "REPLACE" && confirmText !== "DELETE SCHOOL DATA")
                }
              >
                {restoreM.isPending ? "Restoring…" : "Run Restore"}
              </Button>

              <Button
                variant="outline"
                onClick={() => setRestoreId(null)}
              >
                Cancel
              </Button>
            </div>

            <Separator />

            {restoreM.data?.result ? (
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">Restore result</div>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(restoreM.data, null, 2)}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
