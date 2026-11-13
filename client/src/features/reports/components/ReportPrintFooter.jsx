// src/features/reports/components/ReportPrintFooter.jsx
// "Printed / Signature / Date" at the bottom of a printed report (print only).
import { fmtDateTime } from "../utils/format";

export default function ReportPrintFooter({ printedAt }) {
  return (
    <div className="hidden print:block">
      <div className="mt-4 text-xs opacity-70">Printed: {fmtDateTime(printedAt)}</div>
      <div className="mt-6 flex justify-between text-xs">
        <div>Signature: ____________________</div>
        <div>Date: ____________________</div>
      </div>
    </div>
  );
}
