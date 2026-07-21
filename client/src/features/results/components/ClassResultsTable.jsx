// src/features/results/components/ClassResultsTable.jsx
import { Badge } from "@/components/ui/badge";

/**
 * Pure display component. All totals/averages/grades/positions are computed
 * server-side (exams.services#getClassResults) — this table only renders
 * what it's given. Do not recompute ranking/grading here; that math lives in
 * exactly one place (the server) so it can't drift between screens.
 */
export default function ClassResultsTable({ classPayload, showGrades = true }) {
  const subjects = classPayload?.subjects || [];
  const results = classPayload?.results || [];

  if (!subjects.length && !results.length) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/30">
        No results data available.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden print:border-0 print:shadow-none print:m-0">
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm border-collapse print:text-[9.5pt]">
          <thead className="bg-muted/60 print:bg-white">
            <tr>
              <th className="text-left p-2">Adm No</th>
              <th className="text-left p-2">Student</th>

              {subjects.map((sub) => (
                <th key={sub.id} className="text-right p-2">
                  {(sub.name || "").substring(0, 5).toUpperCase()}
                </th>
              ))}

              {showGrades && <th className="text-right p-2">Overall</th>}
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Avg</th>
              <th className="text-right p-2">Pos</th>
              <th className="text-right p-2">Missing</th>
            </tr>
          </thead>

          <tbody>
            {results.map((r) => {
              const st = r.student;
              // Keep column order stable against the subjects header row.
              const scoreBySubject = new Map(
                r.subjectScores.map((s) => [s.subjectId, s.score])
              );

              return (
                <tr key={st.id} className="border-t print:page-break-inside-avoid">
                  <td className="p-2">{st.admissionNo}</td>
                  <td className="p-2">
                    {st.firstName} {st.lastName}
                  </td>

                  {subjects.map((sub) => {
                    const score = scoreBySubject.get(sub.id);
                    return (
                      <td key={sub.id} className="p-2 text-right">
                        {score == null ? "—" : score}
                      </td>
                    );
                  })}

                  {showGrades && (
                    <td className="p-2 text-right">{r.overallGrade || "—"}</td>
                  )}

                  <td className="p-2 text-right">{r.total}</td>
                  <td className="p-2 text-right">{r.average.toFixed(2)}</td>
                  <td className="p-2 text-right">{r.position}</td>
                  <td className="p-2 text-right">
                    <Badge
                      variant={r.missingCount > 0 ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {r.missingCount}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
