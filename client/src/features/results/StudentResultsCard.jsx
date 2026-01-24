// src/features/results/StudentResultsCard.jsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function fmtName(s) {
  const first = s?.firstName || "";
  const last = s?.lastName || "";
  return `${first} ${last}`.trim() || "-";
}

function scoreFromCell(cell) {
  // backward compatible: old payload might be number/null
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object") return cell.score ?? null;
  return cell;
}

function gradeFromCell(cell) {
  if (!cell || typeof cell !== "object") return null;
  return cell.grade ?? null;
}

export default function StudentResultsCard({ payload, classLabel, showGrades = true }) {
  // payload = data.data from getStudentResults
  const session = payload?.session;
  const student = payload?.student;
  const subjects = payload?.subjects || [];
  const cells = payload?.subjectScores || [];

  const gradingMeta = payload?.meta?.grading || null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{session?.name || "My Results"}</CardTitle>
        <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
          <span>{classLabel || session?.classId || "-"}</span>
          <span>•</span>
          <span>
            {session?.term ?? "-"} {session?.year ?? "-"}
          </span>
          <span>•</span>
          <Badge variant="secondary">{session?.status ?? "-"}</Badge>

          {showGrades && gradingMeta?.mode && (
            <>
              <span>•</span>
              <Badge variant="outline">Grading: {gradingMeta.mode}</Badge>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="text-sm">
            <div className="opacity-70">Student</div>
            <div className="font-medium">{fmtName(student)}</div>
            <div className="opacity-70">{student?.admissionNo || "-"}</div>
          </div>

          <div className="text-sm">
            <div className="opacity-70">Summary</div>
            <div className="flex flex-wrap gap-2 items-center">
              <Badge>Total: {payload?.total ?? 0}</Badge>
              <Badge variant="secondary">
                Avg: {Number(payload?.average ?? 0).toFixed(2)}
              </Badge>

              {showGrades && (
                <Badge variant="outline">
                  Grade: {payload?.overallGrade ?? "—"}
                </Badge>
              )}

              <Badge variant="secondary">Pos: {payload?.position ?? "-"}</Badge>
              <Badge variant={payload?.missingCount ? "destructive" : "secondary"}>
                Missing: {payload?.missingCount ?? 0}
              </Badge>
            </div>
          </div>
        </div>

        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Subject</th>
                <th className="text-left p-2">Code</th>
                <th className="text-right p-2">Score</th>
                {showGrades && <th className="text-right p-2">Grade</th>}
              </tr>
            </thead>

            <tbody>
              {subjects.map((sub, idx) => {
                const cell = cells[idx];
                const score = scoreFromCell(cell);
                const grade = gradeFromCell(cell);
                const isMissing = score === null || score === undefined;

                return (
                  <tr key={sub.id} className="border-t">
                    <td className="p-2">{sub.name}</td>
                    <td className="p-2 opacity-70">{sub.code}</td>

                    <td className="p-2 text-right">
                      {isMissing ? (
                        <span className="text-red-600">—</span>
                      ) : (
                        <span className="font-medium">{score}</span>
                      )}
                    </td>

                    {showGrades && (
                      <td className="p-2 text-right">
                        {isMissing ? (
                          <span className="text-red-600">—</span>
                        ) : (
                          <span className="font-medium">{grade ?? "—"}</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {subjects.length === 0 && (
                <tr>
                  <td className="p-3 opacity-70" colSpan={showGrades ? 4 : 3}>
                    No subjects found for this session.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs opacity-60">
          Max/Subject: {payload?.meta?.maxScorePerSubject ?? 100} • Total Max:{" "}
          {payload?.meta?.totalMax ?? "-"} • Computed:{" "}
          {payload?.meta?.computedAt
            ? new Date(payload.meta.computedAt).toLocaleString()
            : "-"}
        </div>
      </CardContent>
    </Card>
  );
}
