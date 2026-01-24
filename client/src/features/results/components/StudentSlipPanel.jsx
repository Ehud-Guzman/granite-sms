import { useMemo } from "react";
import { Button } from "@/components/ui/button";

import PrintDocument from "@/components/print/PrintDocument";
import StudentResultsCard from "../StudentResultsCard";
import { printNow } from "../utils/print";
import { fmtPrintedAt, fmtStudentName } from "../utils/format";

export default function StudentSlipPanel({
  payload,
  classLabel,
  showGrades,
  schoolName,
  sessionName,
  canPrint,
  buttonLabel = "Print Slip",
}) {
  const studentName = useMemo(() => fmtStudentName(payload?.student), [payload]);
  const printedAt = useMemo(() => fmtPrintedAt(new Date()), []);

  const handlePrint = () => {
    if (!payload) return alert("Open a student first.");
    printNow("print-student-slip");
  };

  if (!payload) return null;

  // -------- Screen view (normal UI) --------
  const ScreenView = (
    <div className="space-y-3 no-print">
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handlePrint} disabled={!canPrint}>
          {buttonLabel}
        </Button>
      </div>

      <StudentResultsCard
        payload={payload}
        classLabel={classLabel}
        showGrades={showGrades}
      />
    </div>
  );

  // -------- Print view (standardized) --------
  const PrintView = (
    <PrintDocument id="print-student-slip">
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-base font-semibold">Student Result Slip</div>
          <div className="text-sm opacity-70">{sessionName || "-"}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <b>Student:</b> {studentName}
          </div>
          <div>
            <b>Class:</b> {classLabel || "-"}
          </div>
          <div>
            <b>Printed:</b> {printedAt}
          </div>
          <div>
            <b>School:</b> {schoolName || "School"}
          </div>
        </div>

        <div className="border-t" />

        <StudentResultsCard
          payload={payload}
          classLabel={classLabel}
          showGrades={showGrades}
        />

        <div className="mt-10 grid grid-cols-2 gap-8">
          <div className="border-t pt-2 text-sm">Class Teacher</div>
          <div className="border-t pt-2 text-sm">Principal / Stamp</div>
        </div>
      </div>
    </PrintDocument>
  );

  return (
    <div className="space-y-2">
      {ScreenView}
      {PrintView}
    </div>
  );
}
