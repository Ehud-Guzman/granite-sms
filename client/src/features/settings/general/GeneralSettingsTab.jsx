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

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

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

  const [schoolId, setSchoolId] = useState(() => {
    const v = localStorage.getItem("settings.general.schoolId");
    return v || "";
  });

  useEffect(() => {
    if (sys) localStorage.setItem("settings.general.schoolId", schoolId || "");
  }, [sys, schoolId]);

  const scopeParams = useMemo(() => {
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
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold">General Settings</h3>
          <p className="text-muted-foreground mt-1">
            Select a school to edit general settings.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">School Scope Required</h4>
                <p className="text-sm text-muted-foreground">
                  Enter a school ID to manage its general settings.
                </p>
              </div>

              <div className="max-w-md space-y-3">
                <div className="space-y-1.5">
                  <Label>School ID</Label>
                  <Input
                    value={schoolId}
                    placeholder="school_demo_001"
                    onChange={(e) => setSchoolId(e.target.value.trim())}
                  />
                </div>
                <Button onClick={() => setSchoolId((x) => x.trim())} disabled={!schoolId}>
                  Load Settings
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (schoolQ.isLoading || academicsQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  const anyError = schoolQ.isError || academicsQ.isError;
  if (anyError) {
    const msg =
      schoolQ.error?.response?.data?.message ||
      academicsQ.error?.response?.data?.message ||
      "Failed to load settings";

    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <div className="text-lg font-medium mb-2">Failed to load settings</div>
          <div className="text-muted-foreground mb-4">{msg}</div>
          <div className="flex justify-center gap-2">
            <Button
              onClick={() => {
                schoolQ.refetch();
                academicsQ.refetch();
              }}
            >
              Retry
            </Button>
            {sys && (
              <Button variant="outline" onClick={() => setSchoolId("")}>
                Change School
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">General Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            School profile and academic configuration
          </p>
        </div>
        {sys && schoolId && (
          <Button variant="outline" size="sm" onClick={() => setSchoolId("")}>
            Change School
          </Button>
        )}
      </div>

      {/* School Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">School Profile</CardTitle>
              <CardDescription>
                Identity and contact details used across the system
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {schoolDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saveSchool.isLoading}
                  onClick={onResetSchool}
                >
                  Reset
                </Button>
              )}
              <Button
                size="sm"
                disabled={!schoolDirty || saveSchool.isLoading}
                onClick={onSaveSchool}
              >
                {saveSchool.isLoading ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>School Name</Label>
              <Input
                value={schoolForm?.name || ""}
                onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })}
                placeholder="Enter school name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Short Name</Label>
              <Input
                value={schoolForm?.shortName || ""}
                onChange={(e) => setSchoolForm({ ...schoolForm, shortName: e.target.value })}
                placeholder="e.g. St. Mary"
              />
            </div>
            <div className="space-y-1.5">
              <Label>School Code</Label>
              <Input
                value={schoolForm?.code || ""}
                onChange={(e) => setSchoolForm({ ...schoolForm, code: e.target.value })}
                placeholder="e.g. SMHS"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input
                value={schoolForm?.contactEmail || ""}
                onChange={(e) => setSchoolForm({ ...schoolForm, contactEmail: e.target.value })}
                placeholder="school@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Phone</Label>
              <Input
                value={schoolForm?.contactPhone || ""}
                onChange={(e) => setSchoolForm({ ...schoolForm, contactPhone: e.target.value })}
                placeholder="07xx xxx xxx"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground mt-6 pt-4 border-t">
            <div>
              Created <span className="font-medium">{safeDate(schoolForm?.createdAt)}</span>
            </div>
            <div>
              Last updated <span className="font-medium">{safeDate(schoolForm?.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Academics */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Academic Defaults</CardTitle>
              <CardDescription>
                Defaults used across reports and term-based workflows
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {academicsDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saveAcademics.isLoading}
                  onClick={onResetAcademics}
                >
                  Reset
                </Button>
              )}
              <Button
                size="sm"
                disabled={!academicsDirty || saveAcademics.isLoading}
                onClick={onSaveAcademics}
              >
                {saveAcademics.isLoading ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Current Academic Year</Label>
              <Input
                value={academicsForm?.currentAcademicYear || ""}
                onChange={(e) =>
                  setAcademicsForm({ ...academicsForm, currentAcademicYear: e.target.value })
                }
                placeholder="2025/2026"
              />
              <p className="text-xs text-muted-foreground">Format: 2026 or 2025/2026</p>
            </div>
            <div className="space-y-1.5">
              <Label>Term 1 Label</Label>
              <Input
                value={academicsForm?.term1Label || ""}
                onChange={(e) =>
                  setAcademicsForm({ ...academicsForm, term1Label: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Term 2 Label</Label>
              <Input
                value={academicsForm?.term2Label || ""}
                onChange={(e) =>
                  setAcademicsForm({ ...academicsForm, term2Label: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Term 3 Label</Label>
              <Input
                value={academicsForm?.term3Label || ""}
                onChange={(e) =>
                  setAcademicsForm({ ...academicsForm, term3Label: e.target.value })
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground mt-6 pt-4 border-t">
            <div>
              Created <span className="font-medium">{safeDate(academicsForm?.createdAt)}</span>
            </div>
            <div>
              Last updated <span className="font-medium">{safeDate(academicsForm?.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}