// client/src/features/settings/schools/SchoolsSettingsTab.jsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  listSchools,
  createSchool,
  updateSchool,
  setSchoolStatus,
} from "./schools.api";

import { Badge } from "@/components/ui/badge";
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

function StatusBadge({ active }) {
  return active ? (
    <Badge className="text-[10px]" variant="secondary">
      Active
    </Badge>
  ) : (
    <Badge className="text-[10px]" variant="destructive">
      Suspended
    </Badge>
  );
}

function normalizeId(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function isValidId(v) {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(v);
}

function NewSchoolDialog({ existing = [], onCreated }) {
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const existingIds = useMemo(
    () => new Set(existing.map((s) => String(s.id || "").toLowerCase())),
    [existing]
  );

  const cleanId = normalizeId(schoolId);
  const duplicate = cleanId && existingIds.has(cleanId.toLowerCase());

  const canSubmit =
    !saving &&
    cleanId &&
    name.trim().length >= 2 &&
    isValidId(cleanId) &&
    !duplicate;

  function reset() {
    setSchoolId("");
    setName("");
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    if (!canSubmit) return;

    try {
      setSaving(true);
      const created = await createSchool({ id: cleanId, name: name.trim() });
      toast.success(`School created: ${created?.name || name.trim()}`);
      close();
      onCreated?.();
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || "Failed to create school";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>New school</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create school</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">School ID</div>
            <Input
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              placeholder="e.g. school_demo_002"
              autoFocus
              disabled={saving}
            />

            <div className="text-xs text-muted-foreground">
              Allowed: letters, numbers, <span className="font-medium">_</span> and{" "}
              <span className="font-medium">-</span> (3–40 chars).
              {cleanId ? (
                <>
                  {" "}
                  Normalized: <span className="font-medium">{cleanId}</span>
                </>
              ) : null}
            </div>

            {cleanId && !isValidId(cleanId) ? (
              <div className="text-xs text-red-600">Invalid ID format.</div>
            ) : null}

            {duplicate ? (
              <div className="text-xs text-red-600">School ID already exists.</div>
            ) : null}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">School name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Demo School 2"
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManageSchoolDialog({ school, onChanged }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(school?.name || "");
  const [saving, setSaving] = useState(false);

  const id = school?.id;
  const currentName = school?.name || "";

  const canRename =
    !saving && name.trim().length >= 2 && name.trim() !== currentName;

  async function doRename() {
    if (!canRename) return;

    try {
      setSaving(true);
      await updateSchool(id, { name: name.trim() });
      toast.success("School updated");
      onChanged?.();
      setOpen(false);
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || "Failed to update school";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    try {
      setSaving(true);
      await setSchoolStatus(id, !school.isActive);
      toast.success(!school.isActive ? "School activated" : "School suspended");
      onChanged?.();
      setOpen(false);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to change status";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setName(currentName);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage school</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3 bg-muted/20">
            <div className="font-medium">{currentName || "Unnamed School"}</div>
            <div className="text-xs text-muted-foreground">
              ID: <span className="font-medium">{id}</span>
            </div>
            <div className="mt-2">
              <StatusBadge active={!!school.isActive} />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">School name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="School name"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Close
              </Button>
              <Button onClick={doRename} disabled={!canRename}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {school.isActive ? "Suspend school" : "Activate school"}
              </div>
              <div className="text-xs text-muted-foreground">
                {school.isActive
                  ? "Blocks logins and school operations."
                  : "Re-enables operations."}
              </div>
            </div>

            <Button
              variant={school.isActive ? "destructive" : "default"}
              onClick={toggleStatus}
              disabled={saving}
            >
              {school.isActive ? "Suspend" : "Activate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SchoolsSettingsTab() {
  const [q, setQ] = useState("");

  const schoolsQ = useQuery({
    queryKey: ["schools"],
    queryFn: listSchools,
    staleTime: 30 * 1000,
    retry: false,
  });

  const filtered = useMemo(() => {
    const items = schoolsQ.data || [];
    const s = q.trim().toLowerCase();
    if (!s) return items;

    return items.filter((x) => {
      const id = String(x.id || "").toLowerCase();
      const name = String(x.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [schoolsQ.data, q]);

  const total = (schoolsQ.data || []).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">Schools</div>
          <div className="text-sm text-muted-foreground">
            Platform-level tenant registry.
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => schoolsQ.refetch()}
            disabled={schoolsQ.isLoading}
          >
            Refresh
          </Button>

          <NewSchoolDialog
            existing={schoolsQ.data || []}
            onCreated={() => schoolsQ.refetch()}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by id or name…"
          className="sm:max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {schoolsQ.isLoading ? "Loading…" : `${filtered.length}/${total} school(s)`}
        </div>
      </div>

      {schoolsQ.isError ? (
        <div className="text-sm text-red-600">
          Failed to load schools. Confirm token + role + /api/schools.
        </div>
      ) : null}

      <div className="divide-y rounded-lg border bg-background">
        {schoolsQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading schools…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No schools found.</div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{s.name || "Unnamed School"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  ID: <span className="font-medium">{s.id}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge active={!!s.isActive} />
                <ManageSchoolDialog school={s} onChanged={() => schoolsQ.refetch()} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
