// src/features/reports/components/ReportPrintFooter.jsx
// The "Printed at / Signature / Date" block, previously duplicated verbatim
// at the bottom of every report page.
import { fmtDateTime } from "../utils/format";

export default function ReportPrintFooter({ printedAt }) {
  return (
    <>
      <div className="mt-4 text-xs opacity-70">Printed: {fmtDateTime(printedAt)}</div>
      <div className="mt-6 flex justify-between text-xs">
        <div>Signature: ____________________</div>
        <div>Date: ____________________</div>
      </div>
    </>
  );
}
