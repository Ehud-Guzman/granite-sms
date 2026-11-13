// Settings > Branding: how the school's report cards and result slips look.
// Letterhead lines, a layout, a colour, the lettering, the wording and which
// parts appear, with the real PDF previewed beside the form as it changes.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, RotateCcw } from "lucide-react";

import { api } from "@/api/axios";
import { getPrintSettings, patchPrintSettings } from "@/api/settingsPrint.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowsSkeleton } from "@/components/ui/state-blocks";

const LAYOUTS = [
  { key: "classic", label: "Classic", hint: "Crest and name centred, double rule" },
  { key: "modern", label: "Modern", hint: "Colour band across the top" },
  { key: "compact", label: "Compact", hint: "One-line header, more room for marks" },
];
const SWATCHES = ["#111827", "#1e3a8a", "#0f766e", "#166534", "#7f1d1d", "#9a3412", "#6b21a8", "#b45309"];
const PARTS = [
  ["position", "Position in class", "“4th of 38”"],
  ["attendance", "Attendance", "Report card: days present"],
  ["examColumns", "A column per exam", "Report card: opener, mid-term, end-term"],
  ["remarks", "Subject remarks", "Report card"],
  ["gradingNote", "How the term mark is worked out", "Report card: exam weights and scale"],
  ["classTeacherComment", "Class teacher's comment", "Report card"],
  ["headComment", "Head teacher's comment", "Report card"],
  ["feeBalance", "Fee balance", "“KES 4,500 owed”, from the fees ledger"],
  ["signatures", "Signature lines", ""],
  ["printedDate", "Date printed", "Bottom corner"],
];

const fromServer = (p) => ({
  printShowLogo: p?.printShowLogo !== false,
  printHeaderText: p?.printHeaderText || "",
  printFooterText: p?.printFooterText || "",
  style: {
    ...p?.reportStyle,
    accent: p?.reportStyle?.accent || "",
    signatures: [...(p?.reportStyle?.signatures || []), "", "", ""].slice(0, 3),
  },
});

const toPayload = (f) => ({
  printShowLogo: f.printShowLogo,
  printHeaderText: f.printHeaderText,
  printFooterText: f.printFooterText,
  reportStyle: { ...f.style, accent: f.style.accent || null, signatures: f.style.signatures.map((x) => x.trim()).filter(Boolean) },
});

export default function ReportDesignCard({ schoolId, brandColor }) {
  const qc = useQueryClient();
  const params = schoolId ? { schoolId } : {};
  const q = useQuery({ queryKey: ["printSettings", schoolId || "me"], queryFn: () => getPrintSettings(params) });

  const [form, setForm] = useState(null);
  const loaded = q.data ? fromServer(q.data) : null;
  const f = form || loaded;
  const dirty = !!form && JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(loaded || form));

  const set = (k, v) => setForm((x) => ({ ...(x || loaded), [k]: v }));
  const setStyle = (k, v) => setForm((x) => {
    const base = x || loaded;
    return { ...base, style: { ...base.style, [k]: v } };
  });
  const setShow = (k, v) => setForm((x) => {
    const base = x || loaded;
    return { ...base, style: { ...base.style, show: { ...base.style.show, [k]: v } } };
  });

  const save = useMutation({
    mutationFn: () => patchPrintSettings(toPayload(f), params),
    onSuccess: (p) => {
      toast.success("Report design saved. New downloads use it.");
      qc.setQueryData(["printSettings", schoolId || "me"], p);
      setForm(null);
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Couldn't save the design"),
  });
  const reset = useMutation({
    mutationFn: () => patchPrintSettings({ reportStyle: null }, params),
    onSuccess: (p) => {
      toast.success("Back to the standard design");
      qc.setQueryData(["printSettings", schoolId || "me"], p);
      setForm(null);
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Couldn't reset"),
  });

  // ---- Live preview: the real PDF, redrawn a moment after each change ----
  const [kind, setKind] = useState("report");
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const payloadKey = f ? JSON.stringify(toPayload(f)) : "";
  const lastUrl = useRef(null);
  useEffect(() => {
    if (!payloadKey) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await api.post("/api/settings/print/preview", { kind, print: JSON.parse(payloadKey) }, { params, responseType: "blob" });
        if (cancelled) return;
        const url = URL.createObjectURL(r.data);
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setPdfUrl(url);
        setPreviewError("");
      } catch (e) {
        if (!cancelled) setPreviewError(e?.response?.status === 403 ? "Only admins can preview the design." : "Couldn't draw the preview.");
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // params is rebuilt each render; schoolId is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, kind, schoolId]);
  useEffect(() => () => lastUrl.current && URL.revokeObjectURL(lastUrl.current), []);

  const accentShown = useMemo(() => f?.style.accent || brandColor || "#111827", [f, brandColor]);

  if (q.isLoading || !f) return <RowsSkeleton rows={6} />;
  if (q.isError) return <div className="text-sm text-destructive">Couldn&apos;t load the print settings.</div>;

  const st = f.style;
  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileText className="h-5 w-5 text-primary" /> Report cards and result slips
          </h2>
          <p className="text-sm text-muted-foreground">How your school&apos;s printed and downloaded reports look. The preview is the real PDF, on a made-up learner.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={reset.isPending} onClick={() => reset.mutate()}>
            <RotateCcw className="h-4 w-4" /> Standard design
          </Button>
          <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setForm(null)}>
            Undo changes
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save design
          </Button>
        </div>
      </header>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ---------------- Form ---------------- */}
        <div className="min-w-0 space-y-6">
          <Group title="Layout">
            <div className="grid gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setStyle("layout", l.key)}
                  className={`rounded-xl border p-3 text-left transition hover:bg-muted/50 ${st.layout === l.key ? "border-primary ring-2 ring-primary/30" : ""}`}
                  aria-pressed={st.layout === l.key}
                >
                  <LayoutSketch kind={l.key} accent={accentShown} />
                  <div className="mt-2 text-sm font-medium">{l.label}</div>
                  <div className="text-xs text-muted-foreground">{l.hint}</div>
                </button>
              ))}
            </div>
          </Group>

          <Group title="Colour and lettering">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStyle("accent", "")}
                className={`h-8 rounded-full border px-3 text-xs ${!st.accent ? "border-primary ring-2 ring-primary/30" : ""}`}
                title="Use the school's brand colour"
              >
                <span className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle" style={{ background: brandColor || "#111827" }} />
                Brand colour
              </button>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setStyle("accent", c)}
                  className={`h-8 w-8 rounded-full border-2 ${st.accent === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="color" className="h-8 w-10 cursor-pointer rounded border bg-background" value={st.accent || brandColor || "#111827"} onChange={(e) => setStyle("accent", e.target.value)} />
                Other
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              {[
                ["sans", "Plain (Helvetica)"],
                ["serif", "Traditional (Times)"],
              ].map(([k, label]) => (
                <Button key={k} type="button" size="sm" variant={st.font === k ? "default" : "outline"} onClick={() => setStyle("font", k)} className={k === "serif" ? "font-serif" : ""}>
                  {label}
                </Button>
              ))}
            </div>
          </Group>

          <Group title="Letterhead">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.printShowLogo} onChange={(e) => set("printShowLogo", e.target.checked)} />
              Show the school logo (PNG or JPEG)
            </label>
            <Field label="Motto" value={st.motto} max={120} placeholder="e.g. Strive for excellence" onChange={(v) => setStyle("motto", v)} />
            <Field label="Address line" value={f.printHeaderText} max={300} placeholder="e.g. P.O. Box 1234-20100, Nakuru · 0712 345 678" onChange={(v) => set("printHeaderText", v)} />
            <Field label="Footer" value={f.printFooterText} max={300} placeholder="e.g. This report is not valid without the school stamp." onChange={(v) => set("printFooterText", v)} />
          </Group>

          <Group title="Wording">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Report card title" value={st.reportTitle} max={40} placeholder="Report card" onChange={(v) => setStyle("reportTitle", v)} />
              <Field label="Result slip title" value={st.slipTitle} max={40} placeholder="Result slip" onChange={(v) => setStyle("slipTitle", v)} />
            </div>
            <Field label="Closing note" value={st.closingNote} max={240} placeholder="e.g. Next term opens on Monday 5 January 2027." onChange={(v) => setStyle("closingNote", v)} />
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Signature lines (up to three)</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {st.signatures.map((sig, i) => (
                  <Input
                    key={i}
                    value={sig}
                    maxLength={40}
                    placeholder={["Class teacher", "Principal", "Parent / guardian"][i]}
                    onChange={(e) => setStyle("signatures", st.signatures.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                ))}
              </div>
            </div>
          </Group>

          <Group title="What appears">
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {PARTS.map(([k, label, hint]) => (
                <label key={k} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={!!st.show?.[k]} onChange={(e) => setShow(k, e.target.checked)} />
                  <span>
                    {label}
                    {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </Group>
        </div>

        {/* ---------------- Preview ---------------- */}
        <div className="min-w-0 xl:sticky xl:top-16 xl:self-start">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {[
                ["report", "Report card"],
                ["slip", "Result slip"],
              ].map(([k, label]) => (
                <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
                  {label}
                </Button>
              ))}
            </div>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {dirty ? "Preview of unsaved changes" : "Saved design"}
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border bg-muted/40">
            {previewError ? (
              <div className="p-6 text-sm text-destructive">{previewError}</div>
            ) : pdfUrl ? (
              <iframe title="Report preview" src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`} className="h-[42rem] w-full bg-white" />
            ) : (
              <div className="flex h-[42rem] items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Drawing the preview…
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Every report fits on one A4 page; rows shrink a little when there are many subjects.</p>
        </div>
      </div>
    </section>
  );
}

function Group({ title, children }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, value, onChange, placeholder, max }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input value={value || ""} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A thumbnail of each layout's header, in the chosen colour. */
function LayoutSketch({ kind, accent }) {
  const line = (w, extra = "") => <div className={`h-1 rounded bg-slate-300 ${extra}`} style={{ width: w }} />;
  return (
    <div className="h-20 overflow-hidden rounded-md border bg-white p-2">
      {kind === "modern" ? (
        <div className="-m-2 mb-2 flex items-center gap-1.5 p-2" style={{ background: accent }}>
          <div className="h-4 w-4 rounded-full bg-white" />
          <div className="space-y-1">
            <div className="h-1.5 w-16 rounded bg-white/90" />
            <div className="h-1 w-10 rounded bg-white/60" />
          </div>
        </div>
      ) : kind === "compact" ? (
        <div className="mb-1.5 flex items-center justify-between border-b pb-1.5" style={{ borderColor: accent }}>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-full" style={{ background: accent }} />
            <div className="h-1.5 w-12 rounded bg-slate-500" />
          </div>
          <div className="h-1.5 w-8 rounded" style={{ background: accent }} />
        </div>
      ) : (
        <div className="mb-1.5 flex flex-col items-center gap-1 border-b-2 pb-1.5" style={{ borderColor: accent }}>
          <div className="h-3 w-3 rounded-full" style={{ background: accent }} />
          <div className="h-1.5 w-16 rounded bg-slate-500" />
        </div>
      )}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded" style={{ background: kind === "modern" ? accent : `${accent}33` }} />
        {line("100%")}
        {line("90%")}
        {line("95%")}
      </div>
    </div>
  );
}
