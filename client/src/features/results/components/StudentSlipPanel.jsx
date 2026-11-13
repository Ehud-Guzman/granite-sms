import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadFromApi } from "@/lib/download";
import { Button } from "@/components/ui/button";

import PrintDocument from "@/components/print/PrintDocument";
import StudentResultsCard from "../StudentResultsCard";
import { printSection } from "@/lib/print";
import { fmtPrintedAt, fmtStudentName } from "../utils/format";

export default function StudentSlipPanel({
  payload,
  classLabel,
  showGrades,
  schoolName,
  sessionName,
  canPrint,
  buttonLabel = "Print Slip",
  // "screen", "print" or both. The print copy must sit outside any no-print
  // container, or the printed page comes out blank.
  part = "both",
}) {
  const studentName = useMemo(() => fmtStudentName(payload?.student), [payload]);
  const printedAt = useMemo(() => fmtPrintedAt(new Date()), []);
  const [downloading, setDownloading] = useState(false);

  // A one-page PDF built by the server: same on every phone and printer.
  const handleDownload = async () => {
    const sessionId = payload?.session?.id;
    const studentId = payload?.student?.id;
    if (!sessionId || !studentId) return;
    setDownloading(true);
    try {
      await downloadFromApi(`/api/exams/sessions/${sessionId}/results/students/${studentId}/pdf`, "result-slip.pdf");
    } catch {
      toast.error("Could not download the slip. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!payload) return alert("Open a student first.");
    printSection("print-student-slip");
  };

  if (!payload) return null;

  // -------- Screen view (normal UI) --------
  const ScreenView = (
    <div className="space-y-3 no-print">
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleDownload} disabled={downloading || !payload?.session?.id}>
          <Download className="mr-1.5 h-4 w-4" />
          {downloading ? "Preparing…" : "Download PDF"}
        </Button>
        <Button variant="outline" onClick={handlePrint} disabled={!canPrint}>
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

  if (part === "screen") return ScreenView;
  if (part === "print") return PrintView;
  return (
    <div className="space-y-2">
      {ScreenView}
      {PrintView}
    </div>
  );
}
