// client/src/features/settings/users/components/ManageUserDialog.jsx
import { useState } from "react";
import { toast } from "sonner";

import { updateUser, setUserStatus, resetUserPassword } from "../users.api";
import { allowedEditRoles } from "../utils/users.util";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import CredentialsDialog from "./CredentialsDialog";

function RoleBadge({ role }) {
  const r = String(role || "").toUpperCase();
  const variant = r === "SYSTEM_ADMIN" ? "default" : r === "ADMIN" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase">
      {r || "—"}
    </Badge>
  );
}

function StatusBadge({ active }) {
  return active ? (
    <Badge className="text-[10px]" variant="secondary">Active</Badge>
  ) : (
    <Badge className="text-[10px]" variant="destructive">Suspended</Badge>
  );
}

export default function ManageUserDialog({ actor, user, onChanged }) {
  const actorRole = String(actor?.role || "").toUpperCase();
  const actorSchoolId = actor?.schoolId || null;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState(String(user?.role || "").toUpperCase());
  const roles = allowedEditRoles(actorRole);

  const wrongSchoolForAdmin =
    actorRole === "ADMIN" &&
    actorSchoolId &&
    user?.schoolId &&
    actorSchoolId !== user.schoolId;

  const targetIsPlatformOwner = String(user?.role || "").toUpperCase() === "SYSTEM_ADMIN";

  const canSaveRole =
    !saving &&
    !wrongSchoolForAdmin &&
    !targetIsPlatformOwner &&
    role !== String(user?.role || "").toUpperCase() &&
    (actorRole === "SYSTEM_ADMIN"
      ? roles.includes(role)
      : actorRole === "ADMIN"
      ? ["TEACHER", "STUDENT"].includes(role)
      : false);

  const canToggleStatus = !saving && !wrongSchoolForAdmin && !targetIsPlatformOwner;

  const [credsOpen, setCredsOpen] = useState(false);
  const [creds, setCreds] = useState({ email: "", tempPassword: "" });

  async function doSaveRole() {
    if (!canSaveRole) return;
    try {
      setSaving(true);
      await updateUser(user.id, { role });
      toast.success("Role updated");
      onChanged?.();
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to update role");
    } finally {
      setSaving(false);
    }
  }

  async function doToggleStatus() {
    if (!canToggleStatus) return;
    try {
      setSaving(true);
      const next = !user.isActive;
      await setUserStatus(user.id, next);
      toast.success(next ? "User activated" : "User suspended");
      onChanged?.();
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to change status");
    } finally {
      setSaving(false);
    }
  }

  async function doResetPassword() {
    if (!canToggleStatus) return;
    try {
      setSaving(true);

      // backend returns { ok, tempPassword }
      const res = await resetUserPassword(user.id); // no password argument
      const tempPassword = res?.tempPassword;

      toast.success("Password reset");
      setOpen(false);

      if (tempPassword) {
        setCreds({ email: user.email, tempPassword });
        setCredsOpen(true);
      } else {
        toast.info("No temp password returned (check backend response).");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to reset password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) setRole(String(user?.role || "").toUpperCase());
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">Manage</Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage user</DialogTitle>
          </DialogHeader>

          {wrongSchoolForAdmin ? (
            <div className="text-sm text-red-600">
              You can only manage users within your school.
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="font-medium truncate">{user.email}</div>
              <div className="text-xs text-muted-foreground">
                ID: <span className="font-medium">{user.id}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <RoleBadge role={user.role} />
                <StatusBadge active={!!user.isActive} />
                <Badge variant="outline" className="text-[10px]">
                  {user.schoolId || "platform"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">Role</div>
                <Select
                  value={role}
                  onValueChange={setRole}
                  disabled={saving || wrongSchoolForAdmin || targetIsPlatformOwner}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                    Close
                  </Button>
                  <Button onClick={doSaveRole} disabled={!canSaveRole}>
                    {saving ? "Saving..." : "Save role"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Security</div>

                <Button
                  variant={user.isActive ? "destructive" : "default"}
                  onClick={doToggleStatus}
                  disabled={!canToggleStatus}
                  className="w-full"
                >
                  {user.isActive ? "Suspend user" : "Activate user"}
                </Button>

                <Button
                  variant="outline"
                  onClick={doResetPassword}
                  disabled={!canToggleStatus}
                  className="w-full"
                >
                  Reset password (auto)
                </Button>

                <Separator />

                <div className="text-xs text-muted-foreground">
                  Reset returns a temporary password once. Share securely.
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CredentialsDialog
        open={credsOpen}
        onOpenChange={setCredsOpen}
        title="Password reset"
        email={creds.email}
        tempPassword={creds.tempPassword}
      />
    </>
  );
}
