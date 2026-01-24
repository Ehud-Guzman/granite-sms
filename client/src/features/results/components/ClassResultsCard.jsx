import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import PrintDocument from "@/components/print/PrintDocument";

export default function ClassResultsCard({
  schoolName,
  sessionName,
  classLabel,
  term,
  year,
  status,
  gradingMode,
  role,

  canPrintClass,
  onPrintClass,

  canPublish,
  publishing,
  onPublish,

  children,
}) {
  // ---------- SCREEN (normal UI) ----------
  const ScreenCard = (
    <Card className="no-print">
      <CardHeader className="space-y-1">
        <CardTitle>Class Results — {sessionName || "Session"}</CardTitle>

        <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
          <span>{classLabel}</span>
          <span>•</span>
          <span>
            {term} {year}
          </span>
          <span>•</span>
          <Badge variant="secondary">{status ?? "-"}</Badge>

          {gradingMode ? (
            <>
              <span>•</span>
              <Badge variant="outline">Grading: {gradingMode}</Badge>
            </>
          ) : null}

          <span>•</span>

          <Button
            variant="secondary"
            onClick={onPrintClass}
            disabled={!canPrintClass}
            title={!canPrintClass ? "Open class results first" : "Print class results"}
          >
            Print Class Results
          </Button>

          {role === "ADMIN" ? (
            <>
              <span>•</span>
              <Button
                variant="outline"
                onClick={onPublish}
                disabled={!canPublish || publishing || status === "PUBLISHED"}
                title={status === "PUBLISHED" ? "Already published" : "Publish results"}
              >
                {publishing ? "Publishing..." : "Publish Results"}
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );

const PrintBlock = (
  <PrintDocument id="print-class-results">
    {/* This wrapper MUST be flex column so mt-auto works */}
    <div className="print-section">
      {/* Everything above signatures */}
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-base font-semibold">Class Results</div>
          <div className="text-sm opacity-70">{sessionName || "Exam Session"}</div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>
            <b>Term/Year:</b> {term || "-"} {year || "-"}
          </div>
          <div className="text-right">
            <b>Class:</b> {classLabel || "-"}
          </div>

          {status ? (
            <div>
              <b>Status:</b> {status}
            </div>
          ) : (
            <div />
          )}

          {gradingMode ? (
            <div className="text-right">
              <b>Grading:</b> {gradingMode}
            </div>
          ) : (
            <div />
          )}
        </div>

        <div className="border-t" />

        <div className="space-y-3">{children}</div>
      </div>

      {/* Signatures pinned to bottom */}
      <div className="mt-auto pt-10 grid grid-cols-2 gap-12 text-sm">
        <div>
          <div className="border-t pt-2">Class Teacher / Exam Teacher</div>
        </div>
        <div className="text-right">
          <div className="border-t pt-2">Principal / Headteacher (Stamp)</div>
        </div>
      </div>
    </div>
  </PrintDocument>
);


  return (
    <div className="space-y-3">
      {ScreenCard}
      {PrintBlock}
    </div>
  );
}
