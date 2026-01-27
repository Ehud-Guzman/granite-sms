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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function StatusBadge({ active }) {
  return active ? (
    <Badge variant="default" className="font-normal">
      Active
    </Badge>
  ) : (
    <Badge variant="destructive" className="font-normal">
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New School</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New School</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">School ID</div>
            <Input
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              placeholder="e.g. school_demo_002"
              autoFocus
              disabled={saving}
            />
            <div className="text-xs text-muted-foreground">
              Allowed: letters, numbers, underscore and hyphen (3–40 characters).
            </div>
            {cleanId && (
              <div className="text-xs">
                Normalized ID: <span className="font-medium">{cleanId}</span>
              </div>
            )}
            {cleanId && !isValidId(cleanId) && (
              <div className="text-xs text-destructive">Invalid ID format</div>
            )}
            {duplicate && (
              <div className="text-xs text-destructive">School ID already exists</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">School Name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Demo School 2"
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              {saving ? "Creating..." : "Create School"}
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
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) setName(currentName);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage School</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/10">
            <div className="space-y-2">
              <div>
                <div className="text-sm text-muted-foreground">ID</div>
                <div className="font-medium">{id}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Current Name</div>
                <div className="font-medium">{currentName || "Unnamed School"}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <StatusBadge active={!!school.isActive} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">School Name</div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="School name"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={doRename} disabled={!canRename}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {school.isActive ? "Suspend School" : "Activate School"}
              </div>
              <div className="text-sm text-muted-foreground">
                {school.isActive
                  ? "Blocks logins and school operations."
                  : "Re-enables operations for this school."}
              </div>
            </div>

            <Button
              variant={school.isActive ? "destructive" : "default"}
              onClick={toggleStatus}
              disabled={saving}
              className="w-full"
            >
              {school.isActive ? "Suspend School" : "Activate School"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SchoolsSettingsTab() {
  const [search, setSearch] = useState("");

  const schoolsQ = useQuery({
    queryKey: ["schools"],
    queryFn: listSchools,
    staleTime: 30 * 1000,
    retry: false,
  });

  const filtered = useMemo(() => {
    const items = schoolsQ.data || [];
    const s = search.trim().toLowerCase();
    if (!s) return items;

    return items.filter((x) => {
      const id = String(x.id || "").toLowerCase();
      const name = String(x.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [schoolsQ.data, search]);

  const total = (schoolsQ.data || []).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Schools Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-level tenant registry and management
          </p>
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-sm">
          Showing <span className="font-medium">{filtered.length}</span> of{" "}
          <span className="font-medium">{total}</span> schools
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or name..."
          className="sm:max-w-sm"
        />
      </div>

      {schoolsQ.isError ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">Failed to load schools</div>
            <div className="text-muted-foreground mb-4">
              Please check your permissions and try again.
            </div>
            <Button onClick={() => schoolsQ.refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : schoolsQ.isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">Loading schools...</div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-lg font-medium mb-2">No schools found</div>
            <p className="text-muted-foreground mb-4">
              {search ? "Try a different search term" : "Create your first school to get started"}
            </p>
            {!search && (
              <NewSchoolDialog
                existing={schoolsQ.data || []}
                onCreated={() => schoolsQ.refetch()}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div>
                      <div className="font-medium">{s.name || "Unnamed School"}</div>
                      <div className="text-sm text-muted-foreground">
                        ID: <span className="font-medium">{s.id}</span>
                      </div>
                    </div>
                    <StatusBadge active={!!s.isActive} />
                  </div>
                  <ManageSchoolDialog school={s} onChanged={() => schoolsQ.refetch()} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}