import { Badge } from "@/components/ui/badge";
import { scoreFromCell, gradeFromCell } from "../utils/format";

export default function ClassResultsTable({ classPayload, showGrades }) {
  const subjects = classPayload?.subjects || [];
  const results = classPayload?.results || [];

  // For printing: avoid ultra-wide by letting subjects wrap nicely
  // (CSS handles print borders + visibility)
  return (
    <div className="border rounded-md overflow-auto print:overflow-visible">
      <table className="w-full text-sm print-table">
        <thead className="bg-muted/50 print:bg-transparent">
          <tr>
            {/* Sticky first columns on screen only */}
            <th className="text-left p-2 whitespace-nowrap sticky left-0 bg-background z-10 print:static print:bg-transparent">
              Adm
            </th>
            <th className="text-left p-2 min-w-[180px] sticky left-[64px] bg-background z-10 print:static print:bg-transparent">
              Student
            </th>

            {subjects.map((sub) => {
              const label = sub.code || sub.name || "-";
              return (
                <th
                  key={sub.id}
                  className="text-right p-2 min-w-[64px] whitespace-nowrap"
                  title={sub.name || label}
                >
                  {/* On screen: compact codes. On print: show full name if no code */}
                  <span className="hidden print:inline">
                    {sub.code ? `${sub.code} — ${sub.name}` : label}
                  </span>
                  <span className="print:hidden">{label}</span>
                </th>
              );
            })}

            {showGrades && (
              <th className="text-right p-2 whitespace-nowrap min-w-[110px]">
                Overall Grade
              </th>
            )}

            <th className="text-right p-2 whitespace-nowrap min-w-[70px]">Total</th>
            <th className="text-right p-2 whitespace-nowrap min-w-[70px]">Avg</th>
            <th className="text-right p-2 whitespace-nowrap min-w-[60px]">Pos</th>
            <th className="text-right p-2 whitespace-nowrap min-w-[80px]">Missing</th>
          </tr>
        </thead>

        <tbody>
          {results.map((r) => {
            const st = r.student;

            return (
              <tr key={st.id} className="border-t">
                {/* Sticky first columns on screen only */}
                <td className="p-2 whitespace-nowrap sticky left-0 bg-background z-10 print:static print:bg-transparent">
                  {st.admissionNo}
                </td>

                <td className="p-2 sticky left-[64px] bg-background z-10 print:static print:bg-transparent">
                  <div className="font-medium leading-tight">
                    {st.firstName} {st.lastName}
                  </div>
                </td>

                {(r.subjectScores || []).map((cell, idx) => {
                  const score = scoreFromCell(cell);
                  const grade = gradeFromCell(cell);
                  const missing = score === null || score === undefined;

                  return (
                    <td key={idx} className="p-2 text-right tabular-nums">
                      {missing ? (
                        <span className="opacity-60">—</span>
                      ) : showGrades && grade ? (
                        <span className="font-medium">
                          {score}
                          <span className="opacity-60"> ({grade})</span>
                        </span>
                      ) : (
                        <span className="font-medium">{score}</span>
                      )}
                    </td>
                  );
                })}

                {showGrades && (
                  <td className="p-2 text-right font-medium">
                    {r.overallGrade ?? "—"}
                  </td>
                )}

                <td className="p-2 text-right font-medium tabular-nums">{r.total}</td>
                <td className="p-2 text-right tabular-nums">
                  {Number(r.average).toFixed(2)}
                </td>
                <td className="p-2 text-right tabular-nums">{r.position}</td>
                <td className="p-2 text-right">
                  {r.missingCount ? (
                    <Badge variant="destructive">{r.missingCount}</Badge>
                  ) : (
                    <Badge variant="secondary">0</Badge>
                  )}
                </td>
              </tr>
            );
          })}

          {results.length === 0 && (
            <tr>
              <td colSpan={subjects.length + (showGrades ? 7 : 6)} className="p-3 opacity-70">
                No results found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Print-only footnote */}
      <div className="print-only mt-3 text-xs opacity-70">
        Note: Positions use competition ranking (e.g., 1, 1, 3 for ties).
      </div>
    </div>
  );
}
