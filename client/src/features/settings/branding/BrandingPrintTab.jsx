import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { useMe } from "@/hooks/useMe";
import { getBranding, patchBranding, uploadBrandLogo } from "@/api/settingsBranding.api";

import { applyBrandingVars, resetBrandingVars, normalizeHex, isValidHex } from "@/lib/branding";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/* =========================
   Helpers
========================= */

function isSysAdmin(meData) {
  const role = String(meData?.user?.role || meData?.role || "").toUpperCase();
  return role === "SYSTEM_ADMIN";
}

function getApiBase() {
  return (api?.defaults?.baseURL || "http://localhost:5000").replace(/\/$/, "");
}

function toAbsUrl(p) {
  if (!p) return null;
  const s = String(p);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `${getApiBase()}${s.startsWith("/") ? "" : "/"}${s}`;
}

function buildPatchNormalized(original, form) {
  // normalize to either "#xxxxxx" or null
  const origPrimary = normalizeHex(original?.brandPrimaryColor || "") || null;
  const origSecondary = normalizeHex(original?.brandSecondaryColor || "") || null;

  const curPrimary = normalizeHex(form?.brandPrimaryColor || "") || null;
  const curSecondary = normalizeHex(form?.brandSecondaryColor || "") || null;

  const patch = {};
  if (origPrimary !== curPrimary) patch.brandPrimaryColor = curPrimary;
  if (origSecondary !== curSecondary) patch.brandSecondaryColor = curSecondary;

  return patch;
}

/* =========================
   Component
========================= */

export default function BrandingPrintTab() {
  const qc = useQueryClient();
  const meQ = useMe();
  const sys = isSysAdmin(meQ?.data);

  // SYSTEM_ADMIN needs a school scope
  const [schoolId, setSchoolId] = useState(
    () => localStorage.getItem("settings.branding.schoolId") || "school_demo_001"
  );

  useEffect(() => {
    if (sys) localStorage.setItem("settings.branding.schoolId", schoolId || "");
  }, [sys, schoolId]);

  const scopeReady = !sys || !!schoolId?.trim();
  const scopeParams = useMemo(() => (sys ? { schoolId: schoolId.trim() } : {}), [sys, schoolId]);

  const brandingQ = useQuery({
    queryKey: ["settings", "branding", sys ? scopeParams.schoolId : "tenant"],
    queryFn: () => getBranding(scopeParams),
    enabled: scopeReady,
  });

  const [form, setForm] = useState({
    brandLogoUrl: null,
    brandPrimaryColor: "",
    brandSecondaryColor: "",
  });

  // Cache-bust nonce (avoid Date.now() inside render)
  const [logoNonce, setLogoNonce] = useState(1);

  useEffect(() => {
    if (!brandingQ.data) return;
    setForm({
      brandLogoUrl: brandingQ.data.brandLogoUrl || null,
      brandPrimaryColor: brandingQ.data.brandPrimaryColor || "",
      brandSecondaryColor: brandingQ.data.brandSecondaryColor || "",
    });
    // bump nonce when fresh data arrives (forces <img> refresh)
    setLogoNonce((n) => n + 1);
  }, [brandingQ.data]);

  const colorsValid = useMemo(() => {
    const p = normalizeHex(form?.brandPrimaryColor);
    const s = normalizeHex(form?.brandSecondaryColor);
    return isValidHex(p) && isValidHex(s);
  }, [form?.brandPrimaryColor, form?.brandSecondaryColor]);

  const dirty = useMemo(() => {
    if (!brandingQ.data) return false;
    const patch = buildPatchNormalized(brandingQ.data, form);
    return Object.keys(patch).length > 0;
  }, [brandingQ.data, form]);

  const saveColors = useMutation({
    mutationFn: (payload) => patchBranding(payload, scopeParams),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "branding", sys ? scopeParams.schoolId : "tenant"], data);

      setForm({
        brandLogoUrl: data.brandLogoUrl || null,
        brandPrimaryColor: data.brandPrimaryColor || "",
        brandSecondaryColor: data.brandSecondaryColor || "",
      });

      applyBrandingVars({
        brandPrimaryColor: data.brandPrimaryColor || "#111827",
        brandSecondaryColor: data.brandSecondaryColor || "#2563eb",
      });

      toast.success("Brand colors saved");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to save colors"),
  });

  const fileRef = useRef(null);

  const uploadLogo = useMutation({
    mutationFn: (file) => uploadBrandLogo(file, scopeParams),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "branding", sys ? scopeParams.schoolId : "tenant"], data);
      setForm((prev) => ({ ...prev, brandLogoUrl: data.brandLogoUrl || null }));
      setLogoNonce((n) => n + 1);
      toast.success("Logo uploaded");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Logo upload failed"),
  });

  const onSave = () => {
    if (!brandingQ.data) return;
    if (!colorsValid) {
      toast.error("Colors must be valid hex like #111827");
      return;
    }

    const patch = buildPatchNormalized(brandingQ.data, form);
    if (Object.keys(patch).length === 0) return;

    saveColors.mutate(patch);
  };

  const onReset = () => {
    if (!brandingQ.data) return;
    setForm({
      brandLogoUrl: brandingQ.data.brandLogoUrl || null,
      brandPrimaryColor: brandingQ.data.brandPrimaryColor || "",
      brandSecondaryColor: brandingQ.data.brandSecondaryColor || "",
    });
  };

  // Option A preview
  const applyPreview = () => {
    if (!colorsValid) {
      toast.error("Fix your color hex values first");
      return;
    }
    applyBrandingVars({
      brandPrimaryColor: normalizeHex(form?.brandPrimaryColor) || "#111827",
      brandSecondaryColor: normalizeHex(form?.brandSecondaryColor) || "#2563eb",
    });
    toast.success("Preview applied (not saved)");
  };

  const resetPreview = () => {
    resetBrandingVars();
    toast.message("Preview reset");
  };

  const logoAbs = toAbsUrl(form?.brandLogoUrl);
  const logoSrc = logoAbs ? `${logoAbs}?v=${brandingQ.data?.updatedAt || logoNonce}` : null;

  /* =========================
     UI states
  ========================= */

  if (sys && !schoolId?.trim()) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">SYSTEM_ADMIN: select a school to edit branding.</div>
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-sm font-medium">School scope</div>
            <div className="max-w-sm space-y-2">
              <Label className="text-xs">schoolId</Label>
              <Input value={schoolId} placeholder="school_demo_001" onChange={(e) => setSchoolId(e.target.value)} />
              <Button size="sm" disabled={!schoolId.trim()} onClick={() => setSchoolId((x) => x.trim())}>
                Load
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (brandingQ.isLoading) return <div className="text-sm text-muted-foreground">Loading branding…</div>;

  if (brandingQ.isError) {
    const msg = brandingQ.error?.response?.data?.message || "Failed to load branding";
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="text-sm font-medium">Couldn’t load Branding</div>
          <div className="text-xs text-muted-foreground">{msg}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => brandingQ.refetch()}>
              Retry
            </Button>
            {sys ? (
              <Button size="sm" variant="outline" onClick={() => setSchoolId("")}>
                Change school
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  /* =========================
     Render
  ========================= */

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Branding</CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                Upload logo + set colors used in dashboard accents and print headers.
              </div>
              {sys ? (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Editing school: <span className="font-mono">{scopeParams.schoolId}</span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => brandingQ.refetch()}>
                Reload
              </Button>

              <Button size="sm" variant="outline" disabled={!dirty || saveColors.isLoading} onClick={onReset}>
                Reset
              </Button>

              <Button size="sm" disabled={!dirty || !colorsValid || saveColors.isLoading} onClick={onSave}>
                {saveColors.isLoading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          {!dirty ? (
            <div className="text-[11px] text-muted-foreground mt-2">No changes to save.</div>
          ) : !colorsValid ? (
            <div className="text-[11px] text-destructive mt-2">Fix invalid hex values first.</div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Logo */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">School logo</div>
              <div className="text-xs text-muted-foreground">PNG/JPG/WEBP • max 2MB</div>

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  uploadLogo.mutate(f);
                  e.target.value = "";
                }}
              />

              <div className="flex gap-2">
                <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploadLogo.isLoading}>
                  {uploadLogo.isLoading ? "Uploading…" : "Upload logo"}
                </Button>

                {form?.brandLogoUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(toAbsUrl(form.brandLogoUrl), "_blank", "noopener,noreferrer")}
                  >
                    View
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border p-4 flex items-center justify-center min-h-[120px] bg-muted/20">
              {logoSrc ? (
                <img src={logoSrc} alt="School logo" className="max-h-24 object-contain" />
              ) : (
                <div className="text-xs text-muted-foreground">No logo uploaded</div>
              )}
            </div>
          </div>

          <Separator />

          {/* Colors */}
          <div className="grid md:grid-cols-2 gap-4">
            <ColorField
              label="Primary color"
              value={form.brandPrimaryColor}
              onChange={(v) => setForm((p) => ({ ...p, brandPrimaryColor: v }))}
            />
            <ColorField
              label="Secondary color"
              value={form.brandSecondaryColor}
              onChange={(v) => setForm((p) => ({ ...p, brandSecondaryColor: v }))}
            />
          </div>

          {/* Preview */}
          <div className="rounded-xl border p-4 space-y-2">
            <div className="text-sm font-medium">Preview</div>
            <div
              className="rounded-lg border p-4 flex items-center justify-between gap-3"
              style={{ borderColor: normalizeHex(form?.brandSecondaryColor) || undefined }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-8 w-8 rounded-md"
                  style={{ background: normalizeHex(form?.brandPrimaryColor) || "#111827" }}
                />
                <div>
                  <div className="text-sm font-medium">Dashboard Accent</div>
                  <div className="text-xs text-muted-foreground">Apply preview instantly (not saved).</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={applyPreview} disabled={!colorsValid}>
                  Preview theme
                </Button>
                <Button size="sm" variant="outline" onClick={resetPreview}>
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Next phase */}
      <Card>
        <CardContent className="p-6">
          <div className="text-sm font-medium">Print Settings</div>
          <div className="text-xs text-muted-foreground mt-1">
            Next: letterhead (show logo, header text, footer text) + apply on receipts/reports.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================
   Color Field (pure + controlled)
========================= */

function ColorField({ label, value, onChange }) {
  const normalized = normalizeHex(value) || "";

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={normalizeHex(normalized) || "#111827"}
          onChange={(e) => onChange(e.target.value)}
          className="w-14 p-1"
        />
        <Input
          value={value || ""}
          placeholder="#111827"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(normalizeHex(value))}
        />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Use hex like <span className="font-mono">#111827</span>
      </div>
    </div>
  );
}
