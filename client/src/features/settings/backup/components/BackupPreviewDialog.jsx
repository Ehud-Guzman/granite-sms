// client/src/features/settings/backup/components/BackupPreviewDialog.jsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { previewBackup } from "../backups.api";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(0, 8) + "…";
}

export default function BackupPreviewDialog({ backupId }) {
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["backup-preview", backupId],
    queryFn: () => previewBackup(backupId),
    enabled: open && !!backupId,
    retry: false,
  });

  const b = q.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Preview
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Backup Preview <Badge variant="outline" className="text-[10px]">{shortId(backupId)}</Badge>
          </DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading preview…</div>
        ) : q.isError ? (
          <div className="text-sm text-destructive">Failed to load preview.</div>
        ) : !b ? (
          <div className="text-sm text-muted-foreground">No data.</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div>Status</div>
              <Badge variant={String(b.status) === "READY" ? "secondary" : "destructive"} className="text-[10px]">
                {b.status}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>School</div>
              <div className="font-medium">{b.schoolId}</div>
            </div>

            <div className="flex items-center justify-between">
              <div>Created At</div>
              <div className="font-medium">{new Date(b.createdAt).toLocaleString()}</div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-2">Meta</div>
              <pre className="text-xs whitespace-pre-wrap break-words">
                {JSON.stringify(b.meta, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
