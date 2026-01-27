// client/src/features/teachers/TeacherFormDrawer.jsx
import { useMemo, useEffect, useState } from "react";
import { toast } from "sonner";

import { createUser } from "@/features/settings/users/users.api";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

async function copy(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  } catch {
    return false;
  }
}

export default function TeacherFormDrawer({ open, onClose, onCreated }) {
  const [saving, setSaving] = useState(false);

  // simple payload — expand as you like
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // show creds ONCE
  const [creds, setCreds] = useState(null); // { userId, email, tempPassword }

  const canSubmit = useMemo(() => {
    return email.trim() && firstName.trim() && lastName.trim() && !saving;
  }, [email, firstName, lastName, saving]);

  const resetForm = () => {
    setEmail("");
    setFirstName("");
    setLastName("");
  };

  // ✅ When drawer opens fresh, clear old creds
  useEffect(() => {
    if (open) {
      setCreds(null);
      setSaving(false);
    }
  }, [open]);

  async function handleCreate() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) return toast.error("Email is required");
    if (!firstName.trim()) return toast.error("First name is required");
    if (!lastName.trim()) return toast.error("Last name is required");

    setSaving(true);
    try {
      // IMPORTANT: This relies on your backend /api/users creating tempPassword
      const res = await createUser({
        email: cleanEmail,
        role: "TEACHER",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });

      const user = res?.user || null;
      const createdEmail = user?.email || cleanEmail;
      const tempPassword = res?.tempPassword || null;

      toast.success("Teacher account created");

      // ✅ show creds modal (if available)
      if (tempPassword) {
        setCreds({
          userId: user?.id || null,
          email: createdEmail,
          tempPassword,
        });
      } else {
        toast.message("Teacher created (no temp password returned).");
      }

      // ✅ CRITICAL: pass res back so parent can store creds + invalidate queries properly
      onCreated?.(res);

      // ✅ reset inputs, and close the drawer UI
      resetForm();
      onClose?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create teacher");
    } finally {
      setSaving(false);
    }
  }

  const copyAll = async () => {
    const txt = `Teacher login\nEmail: ${creds?.email || "-"}\nTemp Password: ${creds?.tempPassword || "-"}`;
    const ok = await copy(txt);
    ok ? toast.success("Credentials copied") : toast.error("Copy failed");
  };

  return (
    <>
      {/* Drawer/Main dialog */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose?.();
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Create Teacher</DialogTitle>
            <DialogDescription>
              Creates a TEACHER user and generates a temporary password.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@school.ac.ke"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">First name</label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last name</label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>

            <Separator />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!saving) onClose?.();
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!canSubmit}>
                {saving ? "Creating..." : "Create teacher"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credentials modal */}
      <Dialog
        open={!!creds}
        onOpenChange={(v) => {
          if (!v) setCreds(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Teacher credentials</DialogTitle>
            <DialogDescription>Copy these now — password is shown once.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Email</div>
              <div className="font-mono text-sm break-all">{creds?.email}</div>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const ok = await copy(creds?.email);
                    ok ? toast.success("Email copied") : toast.error("Copy failed");
                  }}
                >
                  Copy email
                </Button>

                <Button size="sm" variant="outline" onClick={copyAll}>
                  Copy all
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Temp password</div>
              <div className="font-mono text-sm break-all">{creds?.tempPassword}</div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={async () => {
                  const ok = await copy(creds?.tempPassword);
                  ok ? toast.success("Temp password copied") : toast.error("Copy failed");
                }}
              >
                Copy password
              </Button>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setCreds(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
