import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PrintDocument from "@/components/print/PrintDocument";

export default function ClassResultsCard({
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
  examType = "End Term",
}) {
  const ScreenCard = (
    <Card className="no-print">
      <CardHeader className="space-y-1">
        <CardTitle>Class Results — {sessionName || "Session"}</CardTitle>

        <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
          <span>{classLabel}</span>•<span>{term} {year}</span>• 
          <Badge variant="secondary">{status ?? "-"}</Badge>

          {gradingMode && <>
            •<Badge variant="outline">Grading: {gradingMode}</Badge>
          </>}

          •
          <Button variant="secondary" onClick={onPrintClass} disabled={!canPrintClass}>
            Print Class Results
          </Button>

          {role === "ADMIN" && <>
            •
            <Button variant="outline" onClick={onPublish} disabled={!canPublish || publishing || status === "PUBLISHED"}>
              {publishing ? "Publishing..." : "Publish Results"}
            </Button>
          </>}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );

  const PrintBlock = (
    <PrintDocument id="print-class-results">
      <div className="bg-white">
        {/* Exam & Class Details */}
        <div className="text-center mb-4">
          <h2 className="text-xl font-semibold">{examType} Results</h2>
          <p className="text-sm mt-1">{sessionName || "Exam Session"} • {term || "Term"} {year || ""}</p>
          <p className="text-sm">Class: {classLabel || "-"}</p>
          <p className="text-sm text-muted-foreground mt-1">Status: {status || "-"}</p>
          {gradingMode && <p className="text-sm text-muted-foreground">Grading Mode: {gradingMode}</p>}
        </div>

        <div className="border-t border-gray-300 my-3" />

        {/* Table only, no interactive elements */}
        <div className="break-inside-auto">{children}</div>
      </div>
    </PrintDocument>
  );

  return <div className="space-y-3">{ScreenCard}{PrintBlock}</div>;
}