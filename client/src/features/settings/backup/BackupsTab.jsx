// client/src/features/settings/backup/BackupsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { me } from "@/api/auth.api";
import { createBackup, listBackups, downloadBackupUrl } from "./backups.api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import BackupPreviewDialog from "./components/BackupPreviewDialog";
import RestoreBackupDialog from "./components/RestoreBackupDialog";

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();
  const variant =
    s === "READY" ? "secondary" : s === "RESTORING" ? "outline" : "destructive";

  return (
    <Badge variant={variant} className="text-[10px] uppercase">
      {s || "—"}
    </Badge>
  );
}

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(0, 8) + "…";
}

export default function BackupsTab() {
  const [schoolId, setSchoolId] = useState("school_demo_001");

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: me,
    staleTime: 60 * 1000,
    retry: false,
  });

  const actor = meQ.data?.user ?? meQ.data;
  const actorRole = String(actor?.role || "").toUpperCase();

  const canUse = actorRole === "SYSTEM_ADMIN";

  const backupsQ = useQuery({
    queryKey: ["backups", schoolId],
    queryFn: () => listBackups({ schoolId }),
    enabled: canUse && !!schoolId.trim(),
    retry: false,
  });

  const items = backupsQ.data || [];

  const filtered = useMemo(() => {
    return items;
  }, [items]);

  async function onCreateBackup() {
    try {
      await createBackup({ schoolId });
      toast.success("Backup created");
      backupsQ.refetch();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Backup failed");
    }
  }

  function onDownload(id) {
    const baseURL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:5000";
    const url = downloadBackupUrl(baseURL, id, schoolId);
    window.open(url, "_blank");
  }

  if (meQ.isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (meQ.isError) return <div className="p-4 text-sm text-destructive">Failed to load identity.</div>;

  if (!canUse) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Backups are available only to <span className="font-medium">SYSTEM_ADMIN</span>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">Backups & Restore</div>
          <div className="text-sm text-muted-foreground">
            Create snapshots, preview, download, and restore safely.
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => backupsQ.refetch()} disabled={backupsQ.isLoading}>
            Refresh
          </Button>
          <Button onClick={onCreateBackup} disabled={backupsQ.isLoading || !schoolId.trim()}>
            Create Backup
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          placeholder="school_demo_001"
          className="sm:max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {backupsQ.isLoading ? "Loading…" : `${filtered.length} backup(s)`}
        </div>
      </div>

      {backupsQ.isError ? (
        <div className="text-sm text-destructive">
          Failed to load backups. Confirm role + token + backend routes.
        </div>
      ) : null}

      <div className="divide-y rounded-lg border bg-background">
        {backupsQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading backups…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No backups found.</div>
        ) : (
          filtered.map((b) => (
            <div key={b.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium">Backup</div>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {shortId(b.id)}
                  </Badge>
                  <StatusBadge status={b.status} />
                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(b.createdAt).toLocaleString()} • {b.schoolId}
                </div>

                {b.meta?.counts ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {Object.entries(b.meta.counts).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[10px]">
                        {k}:{v}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <BackupPreviewDialog backupId={b.id} />
                <Button size="sm" variant="outline" onClick={() => onDownload(b.id)}>
                  Download
                </Button>
                <RestoreBackupDialog
                  backupId={b.id}
                  defaultSchoolId={schoolId}
                  onDone={() => backupsQ.refetch()}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
