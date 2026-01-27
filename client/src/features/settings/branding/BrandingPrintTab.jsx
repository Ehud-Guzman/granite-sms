import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { getBranding, patchBranding, uploadBrandLogo } from "@/api/settingsBranding.api";

import { normalizeHex, isValidHex } from "@/lib/branding";
import { applyAppearance } from "@/lib/appearance";

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

const THEME_OPTIONS = [
  { value: "royal-blue", label: "Royal Blue" },
  { value: "emerald", label: "Emerald" },
  { value: "maroon", label: "Maroon" },
  { value: "amber", label: "Amber" },
  { value: "slate", label: "Slate" },
];

const MODE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
];

const RADIUS_OPTIONS = [
  { value: "sharp", label: "Sharp" },
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" },
];

function safeOpt(options, value, fallback) {
  const v = String(value || "").trim();
  return options.some((o) => o.value === v) ? v : fallback;
}

// ✅ one canonical query key
function brandingKey(schoolId) {
  return ["settings", "branding", schoolId || "tenant"];
}

function toUiForm(b = {}) {
  return {
    brandLogoUrl: b.brandLogoUrl || null,
    brandPrimaryColor: b.brandPrimaryColor || "",
    brandSecondaryColor: b.brandSecondaryColor || "",
    themeKey: safeOpt(THEME_OPTIONS, b.themeKey, "royal-blue"),
    mode: safeOpt(MODE_OPTIONS, b.mode, "light"),
    density: safeOpt(DENSITY_OPTIONS, b.density, "normal"),
    radius: safeOpt(RADIUS_OPTIONS, b.radius, "rounded"),
  };
}

/**
 * Patch rules:
 * - colors: send null to clear override (use preset)
 * - knobs: send string values
 */
function buildPatch(original, form) {
  const patch = {};

  const origPrimary = normalizeHex(original?.brandPrimaryColor || "") || null;
  const origSecondary = normalizeHex(original?.brandSecondaryColor || "") || null;

  const curPrimary = normalizeHex(form?.brandPrimaryColor || "") || null;
  const curSecondary = normalizeHex(form?.brandSecondaryColor || "") || null;

  if (origPrimary !== curPrimary) patch.brandPrimaryColor = curPrimary;
  if (origSecondary !== curSecondary) patch.brandSecondaryColor = curSecondary;

  const origThemeKey = safeOpt(THEME_OPTIONS, original?.themeKey, "royal-blue");
  const origMode = safeOpt(MODE_OPTIONS, original?.mode, "light");
  const origDensity = safeOpt(DENSITY_OPTIONS, original?.density, "normal");
  const origRadius = safeOpt(RADIUS_OPTIONS, original?.radius, "rounded");

  const curThemeKey = safeOpt(THEME_OPTIONS, form?.themeKey, "royal-blue");
  const curMode = safeOpt(MODE_OPTIONS, form?.mode, "light");
  const curDensity = safeOpt(DENSITY_OPTIONS, form?.density, "normal");
  const curRadius = safeOpt(RADIUS_OPTIONS, form?.radius, "rounded");

  if (curThemeKey !== origThemeKey) patch.themeKey = curThemeKey;
  if (curMode !== origMode) patch.mode = curMode;
  if (curDensity !== origDensity) patch.density = curDensity;
  if (curRadius !== origRadius) patch.radius = curRadius;

  return patch;
}

function applyFromBranding(b) {
  // applyAppearance is the only DOM writer (theme + optional overrides)
  applyAppearance({
    themeKey: b?.themeKey,
    mode: b?.mode,
    density: b?.density,
    radius: b?.radius,
    brandPrimaryColor: b?.brandPrimaryColor,     // can be null
    brandSecondaryColor: b?.brandSecondaryColor, // can be null
  });
}

function applyFromForm(form) {
  // Convert "" to null so presets show
  applyAppearance({
    themeKey: form?.themeKey,
    mode: form?.mode,
    density: form?.density,
    radius: form?.radius,
    brandPrimaryColor: normalizeHex(form?.brandPrimaryColor) || null,
    brandSecondaryColor: normalizeHex(form?.brandSecondaryColor) || null,
  });
}

/* =========================
   Component
========================= */

export default function BrandingPrintTab() {
  const qc = useQueryClient();
  const meQ = useMe();
  const sys = isSysAdmin(meQ?.data);

  // SYS admin edits by chosen schoolId in this tab
  const [schoolId, setSchoolId] = useState(
    () => localStorage.getItem("settings.branding.schoolId") || "school_demo_001"
  );

  useEffect(() => {
    if (sys) localStorage.setItem("settings.branding.schoolId", schoolId || "");
  }, [sys, schoolId]);

  const scopeReady = !sys || !!schoolId?.trim();
  const scopeParams = useMemo(
    () => (sys ? { schoolId: schoolId.trim() } : {}),
    [sys, schoolId]
  );

  const key = brandingKey(sys ? scopeParams.schoolId : null);

  const brandingQ = useQuery({
    queryKey: key,
    queryFn: () => getBranding(scopeParams), // returns FLAT branding object
    enabled: scopeReady,
    staleTime: 60_000,
  });

  const [form, setForm] = useState({
    brandLogoUrl: null,
    brandPrimaryColor: "",
    brandSecondaryColor: "",
    themeKey: "royal-blue",
    mode: "light",
    density: "normal",
    radius: "rounded",
  });

  // logo cache bust
  const [logoNonce, setLogoNonce] = useState(1);
  const fileRef = useRef(null);

  // Load branding -> form + apply (so refresh keeps theme)
  useEffect(() => {
    if (!brandingQ.data) return;
    const next = toUiForm(brandingQ.data);
    setForm(next);
    setLogoNonce((n) => n + 1);
    applyFromBranding(brandingQ.data);
  }, [brandingQ.data]);

  const colorsValid = useMemo(() => {
    const p = normalizeHex(form?.brandPrimaryColor);
    const s = normalizeHex(form?.brandSecondaryColor);
    return isValidHex(p) && isValidHex(s);
  }, [form?.brandPrimaryColor, form?.brandSecondaryColor]);

  const dirty = useMemo(() => {
    if (!brandingQ.data) return false;
    return Object.keys(buildPatch(brandingQ.data, form)).length > 0;
  }, [brandingQ.data, form]);

  const saveBranding = useMutation({
    mutationFn: (payload) => patchBranding(payload, scopeParams),
    onSuccess: (saved) => {
      // saved is flat branding object
      qc.setQueryData(key, saved);

      const next = toUiForm(saved);
      setForm(next);

      applyFromBranding(saved);
      toast.success("Branding saved");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to save branding"),
  });

  const uploadLogo = useMutation({
    mutationFn: (file) => uploadBrandLogo(file, scopeParams),
    onSuccess: (saved) => {
      qc.setQueryData(key, saved);

      setForm((prev) => ({ ...prev, brandLogoUrl: saved.brandLogoUrl || null }));
      setLogoNonce((n) => n + 1);

      toast.success("Logo uploaded");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Logo upload failed"),
  });

  const onSave = useCallback(() => {
    if (!brandingQ.data) return;

    if (!colorsValid) {
      toast.error("Colors must be valid hex like #111827");
      return;
    }

    const patch = buildPatch(brandingQ.data, form);
    if (Object.keys(patch).length === 0) return;

    saveBranding.mutate(patch);
  }, [brandingQ.data, colorsValid, form, saveBranding]);

  const onReset = () => {
    if (!brandingQ.data) return;
    const next = toUiForm(brandingQ.data);
    setForm(next);
    applyFromBranding(brandingQ.data);
    toast.message("Reset to saved values");
  };

  const applyPreview = () => {
    if (!colorsValid) {
      toast.error("Fix invalid hex values first");
      return;
    }
    applyFromForm(form);
    toast.success("Preview applied (not saved)");
  };

  const resetPreview = () => {
    if (!brandingQ.data) return;
    applyFromBranding(brandingQ.data);
    toast.message("Preview reset");
  };

  const usePresetColors = () => {
    // clear overrides in UI (shows preset instantly)
    const next = { ...form, brandPrimaryColor: "", brandSecondaryColor: "" };
    setForm(next);

    // apply immediately (null => clear overrides)
    applyFromForm(next);

    toast.message("Custom colors cleared. Click Save to persist preset colors.");
  };

  const logoSrc =
    form?.brandLogoUrl
      ? `${form.brandLogoUrl}?v=${brandingQ.data?.updatedAt || logoNonce}`
      : null;

  /* =========================
     UI states
  ========================= */

  if (sys && !schoolId?.trim()) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          SYSTEM_ADMIN: select a school to edit branding.
        </div>
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-sm font-medium">School scope</div>
            <div className="max-w-sm space-y-2">
              <Label className="text-xs">schoolId</Label>
              <Input
                value={schoolId}
                placeholder="school_demo_001"
                onChange={(e) => setSchoolId(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!schoolId.trim()}
                onClick={() => setSchoolId((x) => x.trim())}
              >
                Load
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (brandingQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading branding…</div>;
  }

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
                Preset theme + optional color overrides. Clear overrides to let presets shine.
              </div>
              {sys ? (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Editing school: <span className="font-mono">{scopeParams.schoolId}</span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Button size="sm" variant="outline" onClick={() => brandingQ.refetch()}>
                Reload
              </Button>

              <Button size="sm" variant="outline" onClick={usePresetColors}>
                Use preset colors
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || saveBranding.isPending}
                onClick={onReset}
              >
                Reset
              </Button>

              <Button
                size="sm"
                disabled={!dirty || !colorsValid || saveBranding.isPending}
                onClick={onSave}
              >
                {saveBranding.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          {!dirty ? (
            <div className="text-[11px] text-muted-foreground mt-2">
              No changes to save.
            </div>
          ) : !colorsValid ? (
            <div className="text-[11px] text-destructive mt-2">
              Fix invalid hex values first.
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Logo */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">School logo</div>
              <div className="text-xs text-muted-foreground">
                PNG/JPG/WEBP • max 2MB
              </div>

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
                <Button
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadLogo.isPending}
                >
                  {uploadLogo.isPending ? "Uploading…" : "Upload logo"}
                </Button>
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

          {/* Theme controls */}
          <div className="grid md:grid-cols-2 gap-4">
            <SelectField
              label="Theme preset"
              value={form.themeKey}
              onChange={(v) => setForm((p) => ({ ...p, themeKey: v }))}
              options={THEME_OPTIONS}
              hint="Presets change the overall skin. Custom colors override preset accents."
            />

            <SelectField
              label="Mode"
              value={form.mode}
              onChange={(v) => setForm((p) => ({ ...p, mode: v }))}
              options={MODE_OPTIONS}
              hint="Dark mode is optional. Light mode is safest for printing."
            />

            <SelectField
              label="Density"
              value={form.density}
              onChange={(v) => setForm((p) => ({ ...p, density: v }))}
              options={DENSITY_OPTIONS}
              hint="Compact = more data per screen."
            />

            <SelectField
              label="Corner radius"
              value={form.radius}
              onChange={(v) => setForm((p) => ({ ...p, radius: v }))}
              options={RADIUS_OPTIONS}
              hint="Sharp is corporate. Rounded is modern. Pill is playful."
            />
          </div>

          <Separator />

          {/* Colors */}
          <div className="grid md:grid-cols-2 gap-4">
            <ColorField
              label="Primary color override (optional)"
              value={form.brandPrimaryColor}
              onChange={(v) => setForm((p) => ({ ...p, brandPrimaryColor: v }))}
            />
            <ColorField
              label="Secondary color override (optional)"
              value={form.brandSecondaryColor}
              onChange={(v) => setForm((p) => ({ ...p, brandSecondaryColor: v }))}
            />
          </div>

          {/* Preview */}
          <div className="rounded-xl border p-4 space-y-2">
            <div className="text-sm font-medium">Preview</div>
            <div className="rounded-lg border p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">UI Theme + Brand</div>
                <div className="text-xs text-muted-foreground">
                  Preview applies instantly (not saved).
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={applyPreview} disabled={!colorsValid}>
                  Preview
                </Button>
                <Button size="sm" variant="outline" onClick={resetPreview}>
                  Reset
                </Button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Tip: If presets don’t look different after Save, your school has color overrides saved.
            Click <span className="font-medium">Use preset colors</span> then Save.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="text-sm font-medium">Print Settings</div>
          <div className="text-xs text-muted-foreground mt-1">
            Next: letterhead (logo, header text, footer text) + apply on receipts/reports.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================
   Fields
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
        Leave blank to use preset colors (recommended).
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options, hint }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <select
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
