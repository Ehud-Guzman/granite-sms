// Frequent absences: learners in a class who missed at least N days in a
// period, most first. The list a class teacher follows up with parents.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listClasses } from "@/api/classes.api";
import { attendanceDefaulters, exportAttendanceDefaulters } from "@/api/attendance.api";
import { printSection } from "@/lib/print";
import { useSchoolCalendar } from "@/lib/schoolCalendar";
import { getErrorMessage as errMsg } from "@/lib/errors";
import PrintDocument from "@/components/print/PrintDocument";
import { HeroPanel, Panel, BarList } from "@/components/insights/Insights";
import ReportPrintTitle from "../components/ReportPrintTitle";
import ReportPrintFooter from "../components/ReportPrintFooter";
import { ReportHeader, FilterBar, Field, SelectInput, TextInput, ReportState } from "../components/ReportKit";
import { normalizeArray, fmtClass, fmtDate } from "../utils/format";
import AttendanceNav from "./AttendanceNav";

export default function AttendanceDefaultersReport() {
  const { today } = useSchoolCalendar();
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [minAbsences, setMinAbsences] = useState("3");

  const classesQ = useQuery({ queryKey: ["classes", "active"], queryFn: () => listClasses({ active: true }) });
  const classes = useMemo(() => normalizeArray(classesQ.data), [classesQ.data]);
  const effectiveClassId = classId || classes[0]?.id || "";
  const selectedClass = classes.find((c) => String(c.id) === String(effectiveClassId)) || null;

  const params =
    effectiveClassId && from && to && from <= to ? { classId: String(effectiveClassId), from, to, minAbsences: Math.max(1, Number(minAbsences) || 1) } : null;
  const q = useQuery({ queryKey: ["attendanceReports", "defaulters", params], queryFn: () => attendanceDefaulters(params), enabled: Boolean(params) });
  const rows = useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data]);
  const scope = selectedClass ? fmtClass(selectedClass) : "";
  const span = `${fmtDate(`${from}T12:00:00Z`)} – ${fmtDate(`${to}T12:00:00Z`)}`;
  const totalDays = rows.reduce((n, r) => n + Number(r.absences || 0), 0);

  return (
    <div className="space-y-4">
      <AttendanceNav />
      <ReportHeader
        title="Frequent absences"
        subtitle={`${scope} · ${span} · ${params?.minAbsences ?? minAbsences}+ days absent`}
        ready={Boolean(q.data)}
        onExport={(format) => exportAttendanceDefaulters(params, format)}
        onPrint={() => printSection("print-attendance-defaulters")}
        pdfFrom="print-attendance-defaulters"
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
        <Field label="Absent at least (days)">
          <TextInput value={minAbsences} onChange={setMinAbsences} inputMode="numeric" className="w-28" />
        </Field>
      </FilterBar>

      {!classesQ.isLoading && classes.length === 0 && <ReportState prompt="No classes yet." />}
      <ReportState loading={q.isLoading} error={q.error && errMsg(q.error, "Couldn't load the report")} />

      {q.data && (
        <PrintDocument screen id="print-attendance-defaulters" bodyClassName="space-y-4">
          <ReportPrintTitle title="Frequent absences" subtitle={`${scope} · ${span}`} />
          {rows.length === 0 ? (
            <ReportState prompt={`No learner in ${scope} missed ${params?.minAbsences} or more days in this period.`} />
          ) : (
            <>
              <HeroPanel
                eyebrow={`To follow up · ${scope}`}
                value={rows.length.toLocaleString()}
                caption={`learner${rows.length === 1 ? "" : "s"} absent ${params.minAbsences} or more days`}
                minis={[
                  { label: "Most days missed", value: `${rows[0].absences} · ${rows[0].name}` },
                  { label: "Days missed in all", value: totalDays.toLocaleString(), alert: true },
                  { label: "Period", value: span },
                ]}
              />
              <Panel title="Most absent">
                <BarList
                  tone="alert"
                  items={rows.map((x) => ({
                    key: x.studentId || x.admissionNo,
                    label: x.name,
                    sub: x.admissionNo,
                    value: x.absences,
                    display: `${x.absences} day${x.absences === 1 ? "" : "s"}`,
                  }))}
                />
              </Panel>
              <ReportPrintFooter />
            </>
          )}
        </PrintDocument>
      )}
    </div>
  );
}
