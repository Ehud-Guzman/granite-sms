import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getSchoolProfile,
  patchSchoolProfile,
  getAcademics,
  patchAcademics,
} from "@/api/settingsGeneral.api";

import { useMe } from "@/hooks/useMe";

// UI
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// If you already have a school selector pattern in Backups tab, reuse it here.
// This version provides a simple fallback select input.
// (You can later swap this for your existing <Select> component.)
function isSysAdmin(me) {
  const role = String(me?.role || me?.me?.role || "").toUpperCase();
  return role === "SYSTEM_ADMIN";
}

function safeDate(v) {
  try {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  } catch {
    return "-";
  }
}

function buildPatch(original, current, allowedKeys) {
  const out = {};
  for (const k of allowedKeys) {
    if (current?.[k] !== original?.[k]) out[k] = current?.[k];
  }
  return out;
}

export default function GeneralSettingsTab() {
  const qc = useQueryClient();
  const meQ = useMe();
  const sys = isSysAdmin(meQ);

  // ====== School scope (SYSTEM_ADMIN only) ======
  // You can replace this with your own “school scope selector” later.
  // For now we store last selection so the tab doesn’t reset every refresh.
  const [schoolId, setSchoolId] = useState(() => {
    const v = localStorage.getItem("settings.general.schoolId");
    return v || "";
  });

  useEffect(() => {
    if (sys) localStorage.setItem("settings.general.schoolId", schoolId || "");
  }, [sys, schoolId]);

  const scopeParams = useMemo(() => {
    // ADMIN relies on tenant header; SYSTEM_ADMIN must pass ?schoolId=
    return sys ? { schoolId } : {};
  }, [sys, schoolId]);

  const scopeReady = !sys || !!schoolId;

  /* =========================
     School Profile
  ========================= */

  const schoolQ = useQuery({
    queryKey: ["settings", "school", scopeParams?.schoolId || "tenant"],
    queryFn: () => getSchoolProfile(scopeParams),
    enabled: scopeReady,
  });

  const [schoolForm, setSchoolForm] = useState(null);

  useEffect(() => {
    if (schoolQ.data) setSchoolForm(schoolQ.data);
  }, [schoolQ.data]);

  const schoolDirty = useMemo(() => {
    if (!schoolQ.data || !schoolForm) return false;
    const keys = ["name", "shortName", "code", "contactEmail", "contactPhone"];
    return keys.some((k) => (schoolForm?.[k] ?? null) !== (schoolQ.data?.[k] ?? null));
  }, [schoolForm, schoolQ.data]);

  const saveSchool = useMutation({
    mutationFn: (payload) => patchSchoolProfile(payload, scopeParams),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "school", scopeParams?.schoolId || "tenant"], data);
      setSchoolForm(data);
      toast.success("School profile saved");
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || "Failed to save school profile");
    },
  });

  const onSaveSchool = () => {
    if (!schoolQ.data || !schoolForm) return;

    // PATCH only changed fields (safer)
    const patch = buildPatch(
      schoolQ.data,
      schoolForm,
      ["name", "shortName", "code", "contactEmail", "contactPhone"]
    );

    if (Object.keys(patch).length === 0) return;
    saveSchool.mutate(patch);
  };

  const onResetSchool = () => {
    if (schoolQ.data) setSchoolForm(schoolQ.data);
  };

  /* =========================
     Academics
  ========================= */

  const academicsQ = useQuery({
    queryKey: ["settings", "academics", scopeParams?.schoolId || "tenant"],
    queryFn: () => getAcademics(scopeParams),
    enabled: scopeReady,
  });

  const [academicsForm, setAcademicsForm] = useState(null);

  useEffect(() => {
    if (academicsQ.data) setAcademicsForm(academicsQ.data);
  }, [academicsQ.data]);

  const academicsDirty = useMemo(() => {
    if (!academicsQ.data || !academicsForm) return false;
    const keys = ["currentAcademicYear", "term1Label", "term2Label", "term3Label"];
    return keys.some((k) => (academicsForm?.[k] ?? null) !== (academicsQ.data?.[k] ?? null));
  }, [academicsForm, academicsQ.data]);

  const saveAcademics = useMutation({
    mutationFn: (payload) => patchAcademics(payload, scopeParams),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "academics", scopeParams?.schoolId || "tenant"], data);
      setAcademicsForm(data);
      toast.success("Academic defaults saved");
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || "Failed to save academic defaults");
    },
  });

  const onSaveAcademics = () => {
    if (!academicsQ.data || !academicsForm) return;

    const patch = buildPatch(
      academicsQ.data,
      academicsForm,
      ["currentAcademicYear", "term1Label", "term2Label", "term3Label"]
    );

    if (Object.keys(patch).length === 0) return;
    saveAcademics.mutate(patch);
  };

  const onResetAcademics = () => {
    if (academicsQ.data) setAcademicsForm(academicsQ.data);
  };

  /* =========================
     Render gates
  ========================= */

  if (sys && !schoolId) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Select a school to edit General Settings (SYSTEM_ADMIN scope).
        </div>

        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="text-sm font-medium">School scope</div>
            <div className="text-xs text-muted-foreground">
              Enter the tenant schoolId (e.g. <span className="font-mono">school_demo_001</span>).
              You can upgrade this to a searchable school picker later.
            </div>

            <div className="max-w-sm space-y-2">
              <Label className="text-xs">schoolId</Label>
              <Input
                value={schoolId}
                placeholder="school_demo_001"
                onChange={(e) => setSchoolId(e.target.value.trim())}
              />
              <Button size="sm" onClick={() => setSchoolId((x) => x.trim())} disabled={!schoolId}>
                Load settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (schoolQ.isLoading || academicsQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  // If either query failed, show a unified error panel (still allow retry)
  const anyError = schoolQ.isError || academicsQ.isError;
  if (anyError) {
    const msg =
      schoolQ.error?.response?.data?.message ||
      academicsQ.error?.response?.data?.message ||
      "Failed to load settings";

    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="text-sm font-medium">Couldn’t load General Settings</div>
          <div className="text-xs text-muted-foreground">{msg}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { schoolQ.refetch(); academicsQ.refetch(); }}>
              Retry
            </Button>
            {sys ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSchoolId("")}
              >
                Change school
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* School Profile */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">School Profile</CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                Identity and contact details used across printed documents and system headers.
              </div>
            </div>

            <div className="flex items-center gap-2">
              {sys ? (
                <Button size="sm" variant="outline" onClick={() => setSchoolId("")}>
                  Change school
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={!schoolDirty || saveSchool.isLoading}
                onClick={onResetSchool}
              >
                Reset
              </Button>
              <Button
                size="sm"
                disabled={!schoolDirty || saveSchool.isLoading}
                onClick={onSaveSchool}
              >
                {saveSchool.isLoading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              label="School name"
              value={schoolForm?.name || ""}
              onChange={(v) => setSchoolForm({ ...schoolForm, name: v })}
            />
            <Field
              label="Short name"
              placeholder="e.g. St. Mary"
              value={schoolForm?.shortName || ""}
              onChange={(v) => setSchoolForm({ ...schoolForm, shortName: v })}
            />
            <Field
              label="Code"
              placeholder="e.g. SMHS"
              value={schoolForm?.code || ""}
              onChange={(v) => setSchoolForm({ ...schoolForm, code: v })}
            />
            <Field
              label="Contact email"
              placeholder="school@example.com"
              value={schoolForm?.contactEmail || ""}
              onChange={(v) => setSchoolForm({ ...schoolForm, contactEmail: v })}
            />
            <Field
              label="Contact phone"
              placeholder="07xx xxx xxx"
              value={schoolForm?.contactPhone || ""}
              onChange={(v) => setSchoolForm({ ...schoolForm, contactPhone: v })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>
              Created <span className="font-medium">{safeDate(schoolForm?.createdAt)}</span>
            </div>
            <div>
              Last updated <span className="font-medium">{safeDate(schoolForm?.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Academics */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Academic Defaults</CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                Defaults used across reports and term-based workflows.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!academicsDirty || saveAcademics.isLoading}
                onClick={onResetAcademics}
              >
                Reset
              </Button>
              <Button
                size="sm"
                disabled={!academicsDirty || saveAcademics.isLoading}
                onClick={onSaveAcademics}
              >
                {saveAcademics.isLoading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              label="Current academic year"
              placeholder="2025/2026"
              value={academicsForm?.currentAcademicYear || ""}
              onChange={(v) =>
                setAcademicsForm({ ...academicsForm, currentAcademicYear: v })
              }
              helper="Format: 2026 or 2025/2026"
            />
            <Field
              label="Term 1 label"
              value={academicsForm?.term1Label || ""}
              onChange={(v) =>
                setAcademicsForm({ ...academicsForm, term1Label: v })
              }
            />
            <Field
              label="Term 2 label"
              value={academicsForm?.term2Label || ""}
              onChange={(v) =>
                setAcademicsForm({ ...academicsForm, term2Label: v })
              }
            />
            <Field
              label="Term 3 label"
              value={academicsForm?.term3Label || ""}
              onChange={(v) =>
                setAcademicsForm({ ...academicsForm, term3Label: v })
              }
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>
              Created <span className="font-medium">{safeDate(academicsForm?.createdAt)}</span>
            </div>
            <div>
              Last updated <span className="font-medium">{safeDate(academicsForm?.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tiny quality-of-life: link to subscription tab */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            // keep it simple: SettingsPage uses search param tab
            const url = new URL(window.location.href);
            url.searchParams.set("tab", "subs");
            window.location.assign(url.toString());
          }}
        >
          View Subscription & Limits →
        </Button>
      </div>
    </div>
  );
}

/* =========================
   Field helper
========================= */
function Field({ label, value, onChange, placeholder, helper }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {helper ? (
        <div className="text-[11px] text-muted-foreground">{helper}</div>
      ) : null}
    </div>
  );
}
