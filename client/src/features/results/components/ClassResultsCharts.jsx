// How a class did in one exam, at a glance: the spread of overall grades
// and each subject's average. Small cards; each opens big with a table.
import { ChartCard, ColumnsChart, RankBars } from "@/components/insights/Charts";

const r1 = (n) => Math.round(n * 10) / 10;

export default function ClassResultsCharts({ classPayload, showGrades = true }) {
  const subjects = classPayload?.subjects || [];
  const results = classPayload?.results || [];
  if (results.length < 2) return null;

  const mean = r1(results.reduce((n, r) => n + (Number(r.average) || 0), 0) / results.length);

  // Grades ordered best to worst by the averages of who got them (works for
  // any scale: A-E, CBE levels, KCSE points).
  const byGrade = new Map();
  for (const r of results) {
    const g = r.overallGrade || "—";
    const x = byGrade.get(g) || { n: 0, sum: 0 };
    x.n += 1;
    x.sum += Number(r.average) || 0;
    byGrade.set(g, x);
  }
  const grades = [...byGrade.entries()]
    .sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
    .map(([g, x]) => ({ key: g, label: g, value: x.n, display: `${x.n} learner${x.n === 1 ? "" : "s"}` }));
  const topGrade = grades.reduce((a, b) => (b.value > a.value ? b : a), grades[0]);

  const subjectAvgs = subjects
    .map((sub) => {
      const scores = results.map((r) => r.subjectScores.find((x) => x.subjectId === sub.id)?.score).filter((v) => v != null);
      const avg = scores.length ? r1(scores.reduce((a, b) => a + Number(b), 0) / scores.length) : null;
      return { key: sub.id, label: sub.name, value: avg ?? 0, display: avg == null ? "—" : String(avg), n: scores.length };
    })
    .sort((a, b) => b.value - a.value);
  const weakest = subjectAvgs.filter((s) => s.n).slice(-1)[0];

  return (
    <div className="mb-4 grid gap-3 md:grid-cols-2 no-print">
      {showGrades && grades.length > 1 && (
        <ChartCard
          title="Grade spread"
          value={`Class mean ${mean}`}
          caption={`Most common: ${topGrade.label} (${topGrade.value} of ${results.length})`}
          chart={(size) => (
            <ColumnsChart
              points={grades}
              compact={size === "compact"}
              height={size === "compact" ? 70 : 240}
              format={(v) => String(Math.round(v))}
              ariaLabel="Learners per overall grade"
            />
          )}
          table={{ columns: ["Grade", "Learners", "Share"], rows: grades.map((g) => [g.label, g.value, `${Math.round((g.value / results.length) * 100)}%`]) }}
          note="Best grade on the left."
        />
      )}
      {subjectAvgs.length > 0 && (
        <ChartCard
          title="Subject averages"
          value={subjectAvgs[0] ? `${subjectAvgs[0].label} ${subjectAvgs[0].display}` : "—"}
          caption={weakest ? `Weakest: ${weakest.label} (${weakest.display})` : "Out of 100"}
          chart={(size) => <RankBars items={subjectAvgs} max={100} compact={size === "compact"} limit={size === "compact" ? 3 : undefined} />}
          table={{ columns: ["Subject", "Marked", "Average"], rows: subjectAvgs.map((s) => [s.label, s.n, s.display]) }}
          note="Averages out of 100, over learners with a mark."
        />
      )}
    </div>
  );
}
