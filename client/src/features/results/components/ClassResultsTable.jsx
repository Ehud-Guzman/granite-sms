// src/features/results/components/ClassResultsTable.jsx
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { gradeFromCell } from "../utils/format";

export default function ClassResultsTable({
  classPayload = {},
  showGrades = true,
  students = {},
}) {
  // 1️⃣ Prepare student data
  const studentData = classPayload;

  // 2️⃣ Extract subjects from the first student's marks
  const firstStudentMarks = useMemo(() => {
    const values = Object.values(studentData);
    return Array.isArray(values[0]) ? values[0] : [];
  }, [studentData]);

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

  // 3️⃣ Compute per-student results
  const results = useMemo(() => {
    return Object.entries(studentData).map(([studentId, marks], index) => {
      const safeMarks = Array.isArray(marks) ? marks : [];

      const student = students[studentId] || {
        id: studentId,
        admissionNo: `ADM-${studentId.slice(0, 3).toUpperCase()}`,
        firstName: "Learner",
        lastName: `#${index + 1}`,
      };

      const subjectScores = safeMarks.map((m) => ({
        score: m.score ?? null,
        grade: gradeFromCell(m.score),
        missing: m.score == null,
      }));

      const total = subjectScores.reduce((sum, cell) => sum + (cell.score || 0), 0);
      const average = subjectScores.length ? total / subjectScores.length : 0;

      const roundedAvg = Math.round(average);
      const overallGrade = gradeFromCell(roundedAvg) || "—";

      return {
        student,
        subjectScores,
        total,
        average: Number(average.toFixed(2)),
        overallGrade,
        missingCount: subjectScores.filter((c) => c.missing).length,
      };
    });
  }, [studentData, students]);

  // 4️⃣ Compute ranking
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

  // 5️⃣ Empty state
  if (!subjects.length && !rankedResults.length) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/30">
        No results data available.
      </div>
    );
  }

  // 6️⃣ Render table
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

                  {showGrades && <td className="p-2 text-right">{r.overallGrade}</td>}

                  <td className="p-2 text-right">{r.total}</td>
                  <td className="p-2 text-right">{r.average}</td>
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