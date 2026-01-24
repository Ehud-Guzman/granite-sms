// client/src/features/settings/users/components/CredentialsDialog.jsx
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { copyToClipboard } from "../utils/users.util";

export default function CredentialsDialog({ open, onOpenChange, title, email, tempPassword }) {
  const [copying, setCopying] = useState(false);

  const creds = `Login credentials\nEmail: ${email}\nTemp password: ${tempPassword}`;

  async function onCopy() {
    try {
      setCopying(true);
      const ok = await copyToClipboard(creds);
      toast.success(ok ? "Copied to clipboard" : "Copy failed — select and copy manually");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="font-medium">Email</div>
            <div className="mt-1 font-mono text-xs break-all">{email}</div>

            <Separator className="my-3" />

            <div className="font-medium">Temporary password</div>
            <div className="mt-1 font-mono text-xs break-all">{tempPassword}</div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={onCopy} disabled={copying}>
              {copying ? "Copying..." : "Copy credentials"}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Share this securely. User should change password later.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
