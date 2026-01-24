import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/hooks/useMe";
import { api } from "@/api/axios";
import { getBranding } from "@/api/settingsBranding.api";
import { getPrintSettings, patchPrintSettings } from "@/api/settingsPrint.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function apiBase() {
  return (api?.defaults?.baseURL || "http://localhost:5000").replace(/\/$/, "");
}
function toAbsUrl(p) {
  if (!p) return null;
  const s = String(p);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `${apiBase()}${s.startsWith("/") ? "" : "/"}${s}`;
}
function isSysAdmin(meData) {
  const role = String(meData?.user?.role || "").toUpperCase();
  return role === "SYSTEM_ADMIN";
}

export default function PrintSettingsTab() {
  const qc = useQueryClient();
  const meQ = useMe();
  const sys = isSysAdmin(meQ.data);

  // optional SYSTEM_ADMIN scope (same pattern as branding)
  const [schoolId, setSchoolId] = useState(
    () => localStorage.getItem("settings.print.schoolId") || "school_demo_001"
  );
  useEffect(() => {
    if (sys) localStorage.setItem("settings.print.schoolId", schoolId || "");
  }, [sys, schoolId]);

  const scopeReady = !sys || !!schoolId?.trim();
  const scopeParams = useMemo(() => (sys ? { schoolId: schoolId.trim() } : {}), [sys, schoolId]);

  const printQ = useQuery({
    queryKey: ["settings", "print", sys ? scopeParams.schoolId : "tenant"],
    queryFn: () => getPrintSettings(scopeParams),
    enabled: scopeReady,
  });

  const brandingQ = useQuery({
    queryKey: ["settings", "branding", "for-print", sys ? scopeParams.schoolId : "tenant"],
    queryFn: () => getBranding(scopeParams),
    enabled: scopeReady,
  });

  const [form, setForm] = useState({
    printShowLogo: true,
    printHeaderText: "",
    printFooterText: "",
  });

  useEffect(() => {
    if (!printQ.data) return;
    setForm({
      printShowLogo: !!printQ.data.printShowLogo,
      printHeaderText: printQ.data.printHeaderText || "",
      printFooterText: printQ.data.printFooterText || "",
    });
  }, [printQ.data]);

  const dirty = useMemo(() => {
    if (!printQ.data) return false;
    return (
      !!form.printShowLogo !== !!printQ.data.printShowLogo ||
      (form.printHeaderText || "") !== (printQ.data.printHeaderText || "") ||
      (form.printFooterText || "") !== (printQ.data.printFooterText || "")
    );
  }, [form, printQ.data]);

  const saveM = useMutation({
    mutationFn: (payload) => patchPrintSettings(payload, scopeParams),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "print", sys ? scopeParams.schoolId : "tenant"], data);
      setForm({
        printShowLogo: !!data.printShowLogo,
        printHeaderText: data.printHeaderText || "",
        printFooterText: data.printFooterText || "",
      });
      toast.success("Print settings saved");
    },
    onError: (err) => toast.error(err?.response?.data?.message || "Failed to save print settings"),
  });

  const schoolName =
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    meQ.data?.user?.school?.name ||
    "-";

  const logoAbs = toAbsUrl(brandingQ.data?.brandLogoUrl);

  if (sys && !schoolId?.trim()) {
    return (
      <Card>
        <CardContent className="p-6 space-y-2">
          <div className="text-sm font-medium">School scope</div>
          <div className="text-xs text-muted-foreground">
            SYSTEM_ADMIN must select a school to edit print settings.
          </div>
          <div className="max-w-sm space-y-2">
            <Label className="text-xs">schoolId</Label>
            <Input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} placeholder="school_demo_001" />
            <Button size="sm" disabled={!schoolId.trim()} onClick={() => setSchoolId((x) => x.trim())}>
              Load
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (printQ.isLoading || brandingQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading print settings…</div>;
  }

  if (printQ.isError) {
    return (
      <Card>
        <CardContent className="p-6 space-y-2">
          <div className="text-sm font-medium">Couldn’t load print settings</div>
          <div className="text-xs text-muted-foreground">
            {printQ.error?.response?.data?.message || "Request failed"}
          </div>
          <Button size="sm" onClick={() => printQ.refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const onSave = () => {
    saveM.mutate({
      printShowLogo: !!form.printShowLogo,
      printHeaderText: form.printHeaderText,
      printFooterText: form.printFooterText,
    });
  };

  const onReset = () => {
    if (!printQ.data) return;
    setForm({
      printShowLogo: !!printQ.data.printShowLogo,
      printHeaderText: printQ.data.printHeaderText || "",
      printFooterText: printQ.data.printFooterText || "",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Print & Letterhead</CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                Configure how your receipts and reports appear when printed.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => printQ.refetch()}>
                Reload
              </Button>
              <Button size="sm" variant="outline" disabled={!dirty || saveM.isLoading} onClick={onReset}>
                Reset
              </Button>
              <Button size="sm" disabled={!dirty || saveM.isLoading} onClick={onSave}>
                {saveM.isLoading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Show logo on prints</div>
              <div className="text-xs text-muted-foreground">
                Centered logo above the school name.
              </div>
            </div>
            <Switch
              checked={!!form.printShowLogo}
              onCheckedChange={(v) => setForm((p) => ({ ...p, printShowLogo: !!v }))}
            />
          </div>

          <Separator />

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Header text (multi-line)</Label>
              <Textarea
                value={form.printHeaderText}
                onChange={(e) => setForm((p) => ({ ...p, printHeaderText: e.target.value }))}
                placeholder={`P.O Box 123, Town\nTel: 07xx xxx xxx\nEmail: info@school.ac.ke`}
                rows={6}
              />
              <div className="text-[11px] text-muted-foreground">
                Tip: keep it short — address + phone + email is enough.
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Footer text (multi-line)</Label>
              <Textarea
                value={form.printFooterText}
                onChange={(e) => setForm((p) => ({ ...p, printFooterText: e.target.value }))}
                placeholder={`Generated on ${new Date().toLocaleDateString()}\nPowered by SMS`}
                rows={6}
              />
              <div className="text-[11px] text-muted-foreground">
                Tip: add “Generated on …” and a small disclaimer if needed.
              </div>
            </div>
          </div>

          <Separator />

          {/* Preview */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="text-sm font-medium">Preview (Centered Letterhead)</div>

            <div className="rounded-lg border bg-background p-5 print-letterhead-preview">
              {form.printShowLogo && logoAbs ? (
                <div className="flex justify-center mb-2">
                  <img src={logoAbs} alt="logo" className="h-16 object-contain" />
                </div>
              ) : null}

              <div className="text-center font-extrabold tracking-tight text-lg">
                {(schoolName || "School Name").toUpperCase()}
              </div>

              {form.printHeaderText ? (
                <div className="mt-1 text-center text-xs text-muted-foreground whitespace-pre-line">
                  {form.printHeaderText}
                </div>
              ) : (
                <div className="mt-1 text-center text-xs text-muted-foreground">
                  Add header text (address, phone, email) to display here.
                </div>
              )}

              <div className="my-3 h-px bg-border" />

              <div className="text-sm text-muted-foreground">
                (Your receipt/report content will start here…)
              </div>

              {form.printFooterText ? (
                <div className="mt-5 text-center text-[11px] text-muted-foreground whitespace-pre-line">
                  {form.printFooterText}
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
