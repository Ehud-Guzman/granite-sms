// client/src/features/settings/backup/components/RestoreBackupDialog.jsx
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { restoreBackup } from "../backups.api";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function DangerNotice({ mode }) {
  if (mode !== "REPLACE") return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="font-medium text-destructive">Danger Zone</div>
      <div className="text-muted-foreground">
        REPLACE will <span className="font-medium">delete school data</span> then restore from snapshot.
        Use only for rollback / disaster recovery.
      </div>
    </div>
  );
}

export default function RestoreBackupDialog({ backupId, defaultSchoolId, onDone }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("MERGE"); // MERGE | REPLACE
  const [schoolId, setSchoolId] = useState(defaultSchoolId || "");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const needsConfirm = mode === "REPLACE";
  const confirmOk = !needsConfirm || confirm === "DELETE SCHOOL DATA";

  const canSubmit = useMemo(() => {
    if (!backupId) return false;
    if (!schoolId.trim()) return false;
    if (needsConfirm && !confirmOk) return false;
    return true;
  }, [backupId, schoolId, needsConfirm, confirmOk]);

  async function onRestore() {
    if (!canSubmit) return;

    setLoading(true);
    setResult(null);
    try {
      const payload = {
        mode,
        targetSchoolId: schoolId.trim(),
        ...(needsConfirm ? { confirm } : {}),
      };

      const out = await restoreBackup(backupId, payload);
      setResult(out);
      toast.success(`Restore complete (${mode})`);
      onDone?.();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || "Restore failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setTimeout(() => {
      setResult(null);
      setMode("MERGE");
      setConfirm("");
      setSchoolId(defaultSchoolId || "");
    }, 250);
  }

  const createdUsers = result?.result?.createdUsers || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Restore
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Restore Backup
            <Badge variant={mode === "REPLACE" ? "destructive" : "secondary"} className="text-[10px] uppercase">
              {mode}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Backup ID: <span className="font-mono text-xs">{backupId}</span>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "MERGE" ? "default" : "outline"}
              onClick={() => setMode("MERGE")}
              disabled={loading}
            >
              MERGE (Safe)
            </Button>
            <Button
              type="button"
              variant={mode === "REPLACE" ? "destructive" : "outline"}
              onClick={() => setMode("REPLACE")}
              disabled={loading}
            >
              REPLACE (Rollback)
            </Button>
          </div>

          <DangerNotice mode={mode} />

          <div className="space-y-2">
            <div className="text-sm font-medium">Target School ID</div>
            <Input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} placeholder="school_demo_001" />
            <div className="text-xs text-muted-foreground">
              SYSTEM_ADMIN restores are explicit: we require the target schoolId.
            </div>
          </div>

          {needsConfirm ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Type to confirm</div>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder='Type: DELETE SCHOOL DATA'
              />
              <div className="text-xs text-muted-foreground">
                Must match exactly: <span className="font-medium">DELETE SCHOOL DATA</span>
              </div>
            </div>
          ) : null}

          <Separator />

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={loading}>
              Close
            </Button>
            <Button type="button" onClick={onRestore} disabled={!canSubmit || loading}>
              {loading ? "Restoring..." : "Run restore"}
            </Button>
          </div>

          {result ? (
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">Result</div>
              <div className="text-xs text-muted-foreground">
                Mode: <span className="font-medium">{result.mode}</span> • School:{" "}
                <span className="font-medium">{result.targetSchoolId || schoolId}</span>
              </div>

              {createdUsers.length ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Created users (temp passwords)</div>
                  <div className="space-y-1">
                    {createdUsers.map((u) => (
                      <div key={u.email} className="text-xs font-mono">
                        {u.email} → {u.tempPassword}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Save these immediately. Users will be forced to change password on first login.
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  No new users created (MERGE likely updated existing users).
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
