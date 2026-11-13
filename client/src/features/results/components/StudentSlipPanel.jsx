import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { downloadFromApi, printFromApi } from "@/lib/download";
import { Button } from "@/components/ui/button";

import StudentResultsCard from "../StudentResultsCard";

export default function StudentSlipPanel({
  payload,
  classLabel,
  showGrades,
  canPrint,
  buttonLabel = "Print Slip",
  // "screen", "print" or both. The print copy must sit outside any no-print
  // container, or the printed page comes out blank.
  part = "both",
}) {
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

  const [printing, setPrinting] = useState(false);
  const handlePrint = async () => {
    const sessionId = payload?.session?.id;
    const studentId = payload?.student?.id;
    if (!sessionId || !studentId) return;
    setPrinting(true);
    try {
      await printFromApi(`/api/exams/sessions/${sessionId}/results/students/${studentId}/pdf`);
    } catch {
      toast.error("Could not prepare the slip for printing. Try again.");
    } finally {
      setPrinting(false);
    }
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
        <Button variant="outline" onClick={handlePrint} disabled={!canPrint || printing || !payload?.session?.id}>
          <Printer className="mr-1.5 h-4 w-4" />
          {printing ? "Preparing…" : buttonLabel}
        </Button>
      </div>

      <StudentResultsCard
        payload={payload}
        classLabel={classLabel}
        showGrades={showGrades}
      />
    </div>
  );

  // Printing goes through the PDF now, so there is no separate print copy.
  if (part === "print") return null;
  return ScreenView;
}
