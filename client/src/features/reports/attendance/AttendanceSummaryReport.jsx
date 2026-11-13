// Attendance summary for one class over a period: the overall rate, how it
// moved day by day, and the days that were worst.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { attendanceClassSummary, exportAttendanceClassSummary } from "@/api/attendance.api";
import { printSection } from "@/lib/print";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Panel, ColumnChart, SegmentBar } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, SelectInput, TextInput, ReportState } from "../components/ReportKit";
import { normalizeArray, fmtClass, fmtDate } from "../utils/format";
import AttendanceNav from "./AttendanceNav";

const rateOf = (d) => (d.total ? ((Number(d.present || 0) + Number(d.late || 0)) / d.total) * 100 : 0);
const dayLabel = (d) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(d));

export default function AttendanceSummaryReport() {
  const { today } = useSchoolCalendar();
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  const classesQ = useQuery({ queryKey: ["classes", "active"], queryFn: () => listClasses({ active: true }) });
  const classes = useMemo(() => normalizeArray(classesQ.data), [classesQ.data]);
  // Open on the first class rather than an empty page.
  const effectiveClassId = classId || classes[0]?.id || "";
  const selectedClass = classes.find((c) => String(c.id) === String(effectiveClassId)) || null;

  const params = effectiveClassId && from && to && from <= to ? { from, to } : null;
  const q = useQuery({
    queryKey: ["attendanceReports", "summary", effectiveClassId, params],
    queryFn: () => attendanceClassSummary(effectiveClassId, params),
    enabled: Boolean(params),
  });
  const days = useMemo(() => (Array.isArray(q.data?.days) ? q.data.days : []), [q.data]);

  const totals = days.reduce(
    (t, d) => ({
      present: t.present + Number(d.present || 0),
      late: t.late + Number(d.late || 0),
      absent: t.absent + Number(d.absent || 0),
      excused: t.excused + Number(d.excused || 0),
      total: t.total + Number(d.total || 0),
    }),
    { present: 0, late: 0, absent: 0, excused: 0, total: 0 }
  );
  const rate = totals.total ? ((totals.present + totals.late) / totals.total) * 100 : 0;
  const worst = [...days].sort((a, b) => rateOf(a) - rateOf(b)).slice(0, 5);
  const scope = selectedClass ? fmtClass(selectedClass) : "";
  const span = `${fmtDate(`${from}T12:00:00Z`)} – ${fmtDate(`${to}T12:00:00Z`)}`;

  return (
    <div className="space-y-4">
      <AttendanceNav />
      <ReportHeader
        title="Attendance summary"
        subtitle={`${scope} · ${span}`}
        ready={days.length > 0}
        onExport={(format) => exportAttendanceClassSummary(effectiveClassId, params, format)}
        onPrint={() => printSection("print-attendance-summary")}
      />
      <FilterBar>
        <Field label="Class">
          <SelectInput value={effectiveClassId} onChange={setClassId} className="min-w-48">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {fmtClass(c)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="From">
          <TextInput type="date" value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={to} onChange={setTo} />
        </Field>
      </FilterBar>

      {!classesQ.isLoading && classes.length === 0 && <ReportState prompt="No classes yet." />}
      <ReportState loading={q.isLoading} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {q.data && (
        <PrintDocument screen id="print-attendance-summary" bodyClassName="space-y-4">
          <ReportPrintTitle title="Attendance summary" subtitle={`${scope} · ${span}`} />
          {days.length === 0 ? (
            <ReportState prompt="No registers were submitted for this class in this period." />
          ) : (
            <>
              <HeroPanel
                eyebrow={`Came in · ${scope}`}
                value={`${rate.toFixed(1)}%`}
                caption={`present or late, across ${days.length} school day${days.length === 1 ? "" : "s"}`}
                minis={[
                  { label: "Present", value: totals.present.toLocaleString() },
                  { label: "Late", value: totals.late.toLocaleString() },
                  { label: "Absent", value: totals.absent.toLocaleString(), alert: totals.absent > 0 },
                  { label: "Excused", value: totals.excused.toLocaleString() },
                ]}
              />
              <div className="grid gap-4 lg:grid-cols-3">
                <Panel title="Absent each day" subtitle={`${totals.absent} absence${totals.absent === 1 ? "" : "s"} over ${days.length} days`} className="lg:col-span-2">
                  <ColumnChart
                    points={days.map((d) => ({ key: d.date, label: dayLabel(d.date), value: Number(d.absent || 0), display: `${d.absent} absent` }))}
                    ariaLabel="Learners absent each day"
                    tone="alert"
                    empty="Nobody was absent in this period."
                  />
                </Panel>
                <Panel title="All marks">
                  <SegmentBar
                    segments={[
                      { label: "Present", value: totals.present, tone: "good" },
                      { label: "Late", value: totals.late, tone: "warn" },
                      { label: "Absent", value: totals.absent, tone: "alert" },
                      { label: "Excused", value: totals.excused, tone: "muted" },
                    ]}
                  />
                  {worst.length > 0 && (
                    <div className="mt-5">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Lowest days</div>
                      <ul className="space-y-1 text-sm">
                        {worst.map((d) => (
                          <li key={d.date} className="flex justify-between">
                            <span>{fmtDate(d.date)}</span>
                            <span className="font-medium tabular-nums">
                              {Math.round(rateOf(d))}% · {d.absent} absent
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Panel>
              </div>
              <Panel title="Every day">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 px-3 text-right font-medium">Present</th>
                        <th className="py-2 px-3 text-right font-medium">Late</th>
                        <th className="py-2 px-3 text-right font-medium">Absent</th>
                        <th className="py-2 px-3 text-right font-medium">Excused</th>
                        <th className="py-2 pl-3 text-right font-medium">Came in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date} className="border-b last:border-0">
                          <td className="py-2 pr-3">{fmtDate(d.date)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{d.present}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{d.late}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${d.absent ? "text-red-700 dark:text-red-400" : ""}`}>{d.absent}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{d.excused}</td>
                          <td className="py-2 pl-3 text-right font-semibold tabular-nums">{Math.round(rateOf(d))}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <ReportPrintFooter />
            </>
          )}
        </PrintDocument>
      )}
    </div>
  );
}
