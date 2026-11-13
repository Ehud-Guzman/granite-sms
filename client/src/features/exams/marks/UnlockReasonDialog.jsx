// src/features/exams/UnlockReasonDialog.jsx
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function UnlockReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  title = "Unlock marksheet",
  hint = "Give a clear reason. This is audit logged.",
  placeholder = "e.g. Wrong entry on Student ADM0007",
  confirmLabel = "Unlock",
  busyLabel = "Unlocking...",
}) {
  const [reason, setReason] = useState("");

  const canConfirm = reason.trim().length >= 3 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm opacity-70">
            {hint}
          </div>
          <Input
            placeholder={placeholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="text-xs opacity-60">
            Minimum 3 characters.
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
          >
            {loading ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
