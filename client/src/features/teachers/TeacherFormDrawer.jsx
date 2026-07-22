// client/src/features/teachers/TeacherFormDrawer.jsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { createUser } from "@/features/settings/users/users.api";
import { teacherSchema, toTeacherPayload } from "./teachers.schema";
import { getErrorMessage } from "@/lib/errors";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // show creds ONCE
  const [creds, setCreds] = useState(null); // { userId, email, tempPassword }

  const form = useForm({
    resolver: zodResolver(teacherSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
    },
    mode: "onChange",
  });

  const createMut = useMutation({
    mutationFn: (payload) => createUser(payload),
    onSuccess: (res) => {
      const user = res?.user || null;
      const createdEmail = user?.email || form.getValues("email").trim().toLowerCase();
      const tempPassword = res?.tempPassword || null;

      toast.success("Teacher account created");

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

      form.reset();
      onClose?.();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, "Failed to create teacher"));
    },
  });

  const saving = createMut.isPending;

  // ✅ When drawer opens fresh, clear old creds
  useEffect(() => {
    if (open) {
      setCreds(null);
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (values) => {
    createMut.mutate(toTeacherPayload(values));
  };

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
          if (!v && saving) return;
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

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="teacher-email">Email</Label>
              <Input
                id="teacher-email"
                {...form.register("email")}
                placeholder="teacher@school.ac.ke"
                autoComplete="off"
                disabled={saving}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="teacher-first-name">First name</Label>
                <Input
                  id="teacher-first-name"
                  {...form.register("firstName")}
                  placeholder="John"
                  disabled={saving}
                />
                {form.formState.errors.firstName && (
                  <p className="text-sm text-destructive">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacher-last-name">Last name</Label>
                <Input
                  id="teacher-last-name"
                  {...form.register("lastName")}
                  placeholder="Doe"
                  disabled={saving}
                />
                {form.formState.errors.lastName && (
                  <p className="text-sm text-destructive">{form.formState.errors.lastName.message}</p>
                )}
              </div>
            </div>

            <Separator />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!saving) onClose?.();
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.formState.isValid}>
                {saving ? "Creating..." : "Create teacher"}
              </Button>
            </div>
          </form>
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
