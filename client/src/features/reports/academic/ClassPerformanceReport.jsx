// Class performance for one published exam: the class average, how grades
// spread, which subjects are strong or weak, and the ranking.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listExamSessions } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { exportClassPerformanceReport } from "@/api/reports.api";
import { useClassPerformanceReport } from "../hooks/useClassPerformanceReport";
import { printSection } from "@/lib/print";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Ring, Panel, BarList } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, SelectInput, ReportState } from "../components/ReportKit";
import { normalizeArray, fmtClass, fmtNumber } from "../utils/format";

const meanTone = (m) => (m >= 70 ? "good" : m >= 50 ? "primary" : m >= 40 ? "warn" : "alert");
const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-900", "bg-orange-300 text-orange-950"];

export default function ClassPerformanceReport() {
  const { termLabels } = useSchoolCalendar();
  const [classId, setClassId] = useState("");
  const [sessionId, setSessionId] = useState("");

  const classesQ = useQuery({ queryKey: ["classes", "active"], queryFn: () => listClasses({ active: true }) });
  const classes = useMemo(() => normalizeArray(classesQ.data), [classesQ.data]);
  const effectiveClassId = classId || classes[0]?.id || "";

  const sessionsQ = useQuery({
    queryKey: ["examSessions", "published", effectiveClassId],
    queryFn: () => listExamSessions({ classId: String(effectiveClassId), status: "PUBLISHED" }),
    enabled: Boolean(effectiveClassId),
  });
  const sessions = useMemo(() => normalizeArray(sessionsQ.data), [sessionsQ.data]);
  // The latest published exam unless another is picked (and still in the list).
  const effectiveSessionId = sessions.some((s) => s.id === sessionId) ? sessionId : sessions[0]?.id || "";

  const q = useClassPerformanceReport({ sessionId: effectiveSessionId });
  const r = q.data?.data;
  const st = r?.stats;
  const ranking = useMemo(() => r?.ranking || [], [r]);
  const passPct = st?.studentCount ? (st.passCount / st.studentCount) * 100 : 0;
  const subjects = st?.subjectMeans || [];
  const grades = useMemo(() => {
    const avg = new Map();
    for (const x of ranking) {
      const g = x.grade || "N/A";
      const a = avg.get(g) || { sum: 0, n: 0 };
      a.sum += Number(x.average || 0);
      a.n += 1;
      avg.set(g, a);
    }
    const mean = (g) => (avg.get(g) ? avg.get(g).sum / avg.get(g).n : -1);
    return [...(st?.gradeDistribution || [])].sort((a, b) => mean(b.grade) - mean(a.grade));
  }, [ranking, st]);
  const title = r ? `${r.session?.name || "Exam"} · ${fmtClass(r.class)}` : "";
  const termName = r ? `${termLabels?.[r.session?.term] || r.session?.term} ${r.session?.year}` : "";

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Class performance"
        subtitle={r ? `${title} · ${termName}` : "Published exams only"}
        ready={Boolean(r)}
        onExport={(format) => exportClassPerformanceReport(effectiveSessionId, format)}
        onPrint={() => printSection("print-class-performance")}
        pdfFrom="print-class-performance"
      />
      <FilterBar>
        <Field label="Class">
          <SelectInput
            value={effectiveClassId}
            onChange={(v) => {
              setClassId(v);
              setSessionId("");
            }}
            className="min-w-48"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {fmtClass(c)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Exam">
          <SelectInput value={effectiveSessionId} onChange={setSessionId} className="min-w-64" disabled={!sessions.length}>
            {!sessions.length && <option value="">{sessionsQ.isLoading ? "Loading…" : "No published exams"}</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "Exam"} · {termLabels?.[s.term] || s.term} {s.year}
              </option>
            ))}
          </SelectInput>
        </Field>
      </FilterBar>

      {!sessionsQ.isLoading && effectiveClassId && sessions.length === 0 && <ReportState prompt="This class has no published exams yet." />}
      <ReportState loading={q.isLoading && Boolean(effectiveSessionId)} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {r && st && (
        <PrintDocument screen id="print-class-performance" bodyClassName="space-y-4">
          <ReportPrintTitle title="Class performance" subtitle={`${title} · ${termName}`} />
          <HeroPanel
            eyebrow={`Class average · ${title}`}
            value={fmtNumber(st.classMean, 1)}
            caption={`${st.studentCount} learner${st.studentCount === 1 ? "" : "s"} · ${termName}`}
            minis={[
              { label: "Top average", value: ranking[0] ? `${fmtNumber(ranking[0].average, 1)} · ${ranking[0].name}` : "—" },
              { label: `At or above ${r.meta?.passThreshold ?? 50}`, value: st.passCount },
              { label: `Below ${r.meta?.passThreshold ?? 50}`, value: st.failCount, alert: st.failCount > 0 },
            ]}
            aside={
              <Ring percent={passPct} size={136} stroke={14} tone={passPct >= 75 ? "good" : "#ffffff"} track="rgba(255,255,255,0.18)" label={`${Math.round(passPct)}% at or above the pass mark`}>
                <span className="text-3xl font-extrabold tabular-nums leading-none">{Math.round(passPct)}%</span>
                <span className="mt-1 text-xs text-white/75 print:text-black/70">pass mark</span>
              </Ring>
            }
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Subjects" subtitle="Class average per subject, strongest first">
              <BarList
                max={100}
                empty="No subject marks."
                items={subjects.map((s) => ({ key: s.subjectId, label: s.subjectName, value: s.mean, display: fmtNumber(s.mean, 1), tone: meanTone(s.mean) }))}
              />
            </Panel>
            <Panel title="Grades" subtitle="How many learners got each overall grade, best first">
              <BarList
                empty="No grades."
                items={grades.map((g) => ({
                  key: g.grade,
                  label: g.grade,
                  value: g.count,
                  display: `${g.count} · ${st.studentCount ? Math.round((g.count / st.studentCount) * 100) : 0}%`,
                }))}
              />
            </Panel>
          </div>

          <Panel title="Ranking">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Pos.</th>
                    <th className="py-2 px-3 font-medium">Learner</th>
                    <th className="py-2 px-3 text-right font-medium">Total</th>
                    <th className="py-2 px-3 text-right font-medium">Average</th>
                    <th className="py-2 pl-3 text-right font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((x) => (
                    <tr key={x.studentId} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold ${MEDAL[x.position - 1] || "bg-muted"}`}>{x.position}</span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-medium">{x.name}</div>
                        <div className="text-xs text-muted-foreground">{x.admissionNo}</div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtNumber(x.total ?? 0)}</td>
                      <td className="py-2 px-3 text-right font-semibold tabular-nums">{fmtNumber(x.average ?? 0, 1)}</td>
                      <td className="py-2 pl-3 text-right">{x.grade || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <ReportPrintFooter />
        </PrintDocument>
      )}
    </div>
  );
}
