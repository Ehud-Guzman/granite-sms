// client/src/features/settings/users/components/NewUserDialog.jsx
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { createUser } from "../users.api";
import {
  allowedCreateRoles,
  cleanEmail,
  isValidEmail,
  isValidSchoolId,
} from "../utils/users.util";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const norm = (v) => String(v || "").trim().toUpperCase();

// Tenant roles MUST have schoolId
const TENANT_ROLES = ["ADMIN", "BURSAR", "TEACHER", "STUDENT"];

// If you want SYSTEM_ADMIN to be creatable from UI, keep it here.
// Otherwise remove it and the UI will never show it.
const PLATFORM_ROLES = ["SYSTEM_ADMIN"];

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

export default function NewUserDialog({ actor, onCreated }) {
  const actorRole = norm(actor?.role);
  const actorSchoolId = actor?.schoolId || null;

  const canPickSchool = actorRole === "SYSTEM_ADMIN";

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState("");

  // ✅ Better defaults for today: SYSTEM_ADMIN defaults to BURSAR
  const [role, setRole] = useState(() => {
    if (actorRole === "ADMIN") return "TEACHER";
    if (actorRole === "SYSTEM_ADMIN") return "BURSAR";
    return "TEACHER";
  });

  const [schoolId, setSchoolId] = useState(actorSchoolId || "");

  const [credsOpen, setCredsOpen] = useState(false);
  const [creds, setCreds] = useState({ email: "", tempPassword: "" });

  // Roles from util (may be outdated) → we harden it so BURSAR always appears for SYSTEM_ADMIN/ADMIN
  const roles = useMemo(() => {
    const fromUtil = allowedCreateRoles?.(actorRole) || [];

    // “self-heal” in case util wasn’t updated yet
    const hardened =
      actorRole === "SYSTEM_ADMIN"
        ? [...fromUtil, ...TENANT_ROLES /* + PLATFORM_ROLES if you want */]
        : actorRole === "ADMIN"
        ? [...fromUtil, "BURSAR", "TEACHER", "STUDENT"]
        : fromUtil;

    // If you want SYSTEM_ADMIN creatable via UI, uncomment the next line:
    // hardened.push(...PLATFORM_ROLES);

    return uniq(hardened).map(norm);
  }, [actorRole]);

  const clean = cleanEmail(email);
  const chosenRole = norm(role);

  const emailOk = isValidEmail(clean);
  const roleOk = roles.includes(chosenRole);

  const needsSchool =
    canPickSchool && TENANT_ROLES.includes(chosenRole);

  // For SYSTEM_ADMIN:
  // - Tenant roles require valid schoolId
  // - Platform roles (SYSTEM_ADMIN) should not require schoolId
  const schoolOk = !needsSchool
    ? true
    : isValidSchoolId(String(schoolId || "").trim());

  const canSubmit = !saving && emailOk && roleOk && schoolOk;

  function reset() {
    setEmail("");
    setRole(() => {
      if (actorRole === "ADMIN") return "TEACHER";
      if (actorRole === "SYSTEM_ADMIN") return "BURSAR";
      return "TEACHER";
    });
    setSchoolId(actorSchoolId || "");
    setSaving(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    if (!canSubmit) return;

    // extra guardrails for better error messages
    if (!emailOk) return toast.error("Enter a valid email.");
    if (!roleOk) return toast.error("Select a valid role.");
    if (needsSchool && !schoolOk) return toast.error("Enter a valid schoolId.");

    try {
      setSaving(true);

      const payload = {
        email: clean,
        role: chosenRole,
      };

      // SYSTEM_ADMIN controls tenant creation.
      // For tenant roles, schoolId is required.
      if (canPickSchool && TENANT_ROLES.includes(chosenRole)) {
        payload.schoolId = String(schoolId).trim();
      }

      // If you allow SYSTEM_ADMIN creation via UI and want platform users:
      // if (canPickSchool && chosenRole === "SYSTEM_ADMIN") {
      //   // platform user → omit schoolId
      // }

      const res = await createUser(payload);
      const createdUser = res?.user || res;
      const tempPassword = res?.tempPassword;

      toast.success("User created");

      close();
      onCreated?.();

      if (tempPassword) {
        setCreds({ email: createdUser?.email || clean, tempPassword });
        setCredsOpen(true);
      } else {
        toast.info("No temp password returned (check backend response).");
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || "Failed to create user";
      toast.error(msg);
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
          if (!v) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button>New user</Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Email</div>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. bursar@demo.school"
                autoFocus
                disabled={saving}
              />
              {!emailOk && email.trim() ? (
                <div className="text-xs text-red-600">Enter a valid email.</div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">Role</div>
                <Select value={role} onValueChange={setRole} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {!roleOk ? (
                  <div className="text-xs text-red-600">
                    Invalid role selection.
                  </div>
                ) : null}
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium">School</div>
                <Input
                  value={canPickSchool ? schoolId : actorSchoolId || ""}
                  onChange={(e) => setSchoolId(e.target.value)}
                  placeholder="e.g. school_demo_001"
                  disabled={saving || !canPickSchool || !needsSchool}
                />
                {canPickSchool && needsSchool && !schoolOk && schoolId.trim() ? (
                  <div className="text-xs text-red-600">
                    Invalid schoolId format.
                  </div>
                ) : null}
                {canPickSchool && !needsSchool ? (
                  <div className="text-xs text-muted-foreground">
                    School is not required for this role.
                  </div>
                ) : null}
              </div>
            </div>

            <Separator />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!canSubmit}>
                {saving ? "Creating..." : "Create"}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Backend generates a temporary password and returns it once.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CredentialsDialog
        open={credsOpen}
        onOpenChange={setCredsOpen}
        title="User created"
        email={creds.email}
        tempPassword={creds.tempPassword}
      />
    </>
  );
}
