// src/features/results/StudentResultsCard.jsx
import { fmtStudentName } from "./utils/format";

/**
 * Renders one student's result slip for a single exam session.
 * `payload` is the response of GET /api/exams/sessions/:id/results/students/:studentId
 * — shape: { session, student, subjectScores, total, average, overallGrade, missingCount }.
 * All grading/totals are computed server-side (exams.services#getStudentResults);
 * this component only displays them.
 */
export default function StudentResultsCard({ payload, classLabel, showGrades = true }) {
  if (!payload) return null;

  const { student, subjectScores = [], total, average, overallGrade, missingCount } = payload;

  return (
    <div className="border rounded-lg overflow-hidden print:border-0 print:shadow-none print:m-0">
      <div className="p-3 border-b bg-muted/60 print:bg-white">
        <div className="font-medium">{fmtStudentName(student)}</div>
        <div className="text-sm opacity-70">
          {student?.admissionNo ? `Adm No: ${student.admissionNo}` : null}
          {classLabel ? ` • ${classLabel}` : null}
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm border-collapse print:text-[9.5pt]">
          <thead>
            <tr className="text-left">
              <th className="p-2">Subject</th>
              <th className="p-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {subjectScores.length === 0 ? (
              <tr>
                <td className="p-2 text-muted-foreground" colSpan={2}>
                  No marks recorded for this session.
                </td>
              </tr>
            ) : (
              subjectScores.map((s) => (
                <tr key={s.subjectId} className="border-t">
                  <td className="p-2">{s.subjectName}</td>
                  <td className="p-2 text-right">{s.score == null ? "—" : s.score}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="p-2">Total</td>
              <td className="p-2 text-right">{total}</td>
            </tr>
            <tr>
              <td className="p-2">Average</td>
              <td className="p-2 text-right">{Number(average ?? 0).toFixed(2)}</td>
            </tr>
            {showGrades && (
              <tr>
                <td className="p-2">Overall Grade</td>
                <td className="p-2 text-right">{overallGrade || "—"}</td>
              </tr>
            )}
            {missingCount > 0 && (
              <tr>
                <td className="p-2 text-amber-600" colSpan={2}>
                  {missingCount} subject(s) missing a score.
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
