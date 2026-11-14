// The frame every report shares: a heading with export and print on the
// right, and one compact row of filters.
import { useState } from "react";
import { Download, FileDown, Printer } from "lucide-react";
import { downloadTablesPdf } from "@/lib/download";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function ReportHeader({ title, subtitle, ready, onExport, onPrint, pdfFrom }) {
  const [busy, setBusy] = useState(false);
  const run = async (format) => {
    setBusy(true);
    try {
      await onExport(format);
    } catch {
      toast.error("Export failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const pdf = async () => {
    setBusy(true);
    try {
      await downloadTablesPdf(pdfFrom, title, subtitle);
    } catch {
      toast.error("Couldn't make the PDF. Try again.");
    } finally {
      setBusy(false);
    }
  };
  // Pinned under the top bar, so download and print are always to hand.
  return (
    <div className="sticky top-12 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur no-print md:-mx-6 md:px-6">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onExport && (
          <>
            <Button variant="outline" size="sm" disabled={!ready || busy} onClick={() => run("xlsx")}>
              <Download className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
            <Button variant="outline" size="sm" disabled={!ready || busy} onClick={() => run("csv")}>
              CSV
            </Button>
          </>
        )}
        {pdfFrom && (
          <Button size="sm" disabled={!ready || busy} onClick={pdf}>
            <FileDown className="mr-1.5 h-4 w-4" />
            PDF
          </Button>
        )}
        {onPrint && (
          <Button variant="outline" size="sm" disabled={!ready} onClick={onPrint}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print
          </Button>
        )}
      </div>
    </div>
  );
}

export function FilterBar({ children }) {
  return <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4 shadow-sm no-print">{children}</div>;
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${className}`}>
      {label}
      {children}
    </label>
  );
}

const control = "h-9 rounded-md border bg-background px-3 text-sm text-foreground";

export function SelectInput({ value, onChange, children, className = "", ...rest }) {
  return (
    <select className={`${control} ${className}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {children}
    </select>
  );
}

export function TextInput({ className = "", onChange, ...rest }) {
  return <input className={`${control} ${className}`} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

/** "Loading", an error, or a prompt, in one place. */
export function ReportState({ loading, error, prompt }) {
  if (loading) return <div className="h-40 animate-pulse rounded-3xl bg-muted no-print" />;
  if (error) return <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive no-print">{error}</div>;
  if (prompt) return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground no-print">{prompt}</p>;
  return null;
}
