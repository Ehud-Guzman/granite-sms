// src/features/reports/components/ReportPrintTitle.jsx
// Print-only title/subtitle block. School identity (name/logo) is already
// handled by PrintDocument -> PrintLetterhead, so this only needs the
// report-specific heading — it was previously hand-copied into every
// report page instead of shared.
export default function ReportPrintTitle({ title, subtitle }) {
  return (
    <div className="hidden print:block mb-2">
      <div className="text-base font-semibold">{title}</div>
      {subtitle ? <div className="text-sm opacity-70">{subtitle}</div> : null}
    </div>
  );
}
