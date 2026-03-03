// src/features/results/components/ClassResultsTable.jsx
import { Badge } from "@/components/ui/badge";
import { gradeFromCell } from "../../features/results/utils/format";
import { useMemo } from "react";

export default function ClassResultsTable({
  classPayload,
  showGrades = true,
  students = {},
}) {
  const studentData = classPayload || {};

  // Grab first student to get subjects
  const firstStudentMarks = useMemo(() => {
    const values = Object.values(studentData);
    return Array.isArray(values[0]) ? values[0] : [];
  }, [studentData]);

  // Build subjects list
  const subjects = useMemo(() => {
    return firstStudentMarks.map((mark, idx) => {
      const fullName = mark.subjectName || `Subject ${idx + 1}`;
      const code = mark.subjectCode
        ? mark.subjectCode.substring(0, 5).toUpperCase()
        : fullName.substring(0, 3).toUpperCase();
      return {
        id: mark.subjectId || `sub-${idx}`,
        name: fullName,
        code,
      };
    });
  }, [firstStudentMarks]);

  // Process results per student
  const results = useMemo(() => {
    return Object.entries(studentData).map(([studentId, marks], index) => {
      const safeMarks = Array.isArray(marks) ? marks : [];

      const student = students[studentId] || {
        id: studentId,
        admissionNo: `ADM-${studentId.slice(0, 3).toUpperCase()}`,
        firstName: "Learner",
        lastName: `#${index + 1}`,
      };

      // Map subject scores
      const subjectScores = safeMarks.map((m) => {
        const score = m.score != null ? Number(m.score) : null;
        return {
          score,
          grade: score != null ? gradeFromCell({ score }) : null,
          missing: score == null,
        };
      });

      const total = subjectScores.reduce((sum, cell) => sum + (cell.score || 0), 0);
      const validScoresCount = subjectScores.filter((c) => c.score != null).length;
      const average = validScoresCount > 0 ? total / validScoresCount : 0;

      return {
        student,
        subjectScores,
        total,
        average, // keep numeric for grade calculation
        overallGrade: gradeFromCell({ score: average }),
        missingCount: subjectScores.filter((c) => c.missing).length,
      };
    });
  }, [studentData, students]);

  // Rank students (handle ties)
  const rankedResults = useMemo(() => {
    const sorted = [...results].sort(
      (a, b) => b.total - a.total || b.average - a.average
    );

    let rank = 1;
    let prevTotal = null;
    let prevAvg = null;

    return sorted.map((r, idx) => {
      if (prevTotal === null || r.total !== prevTotal || r.average !== prevAvg) {
        rank = idx + 1;
        prevTotal = r.total;
        prevAvg = r.average;
      }
      return { ...r, position: rank };
    });
  }, [results]);

  // Nothing to display
  if (!subjects.length && !rankedResults.length) {
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
                <th key={sub.id} className="text-right p-2">{sub.code}</th>
              ))}

              {showGrades && <th className="text-right p-2">Overall</th>}
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Avg</th>
              <th className="text-right p-2">Pos</th>
              <th className="text-right p-2">Missing</th>
            </tr>
          </thead>

          <tbody>
            {rankedResults.map((r) => {
              const st = r.student;

              return (
                <tr key={st.id} className="border-t print:page-break-inside-avoid">
                  <td className="p-2">{st.admissionNo}</td>
                  <td className="p-2">{st.firstName} {st.lastName}</td>

                  {r.subjectScores.map((cell, idx) => (
                    <td key={idx} className="p-2 text-right">
                      {cell.missing ? "—" : cell.score}
                    </td>
                  ))}

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