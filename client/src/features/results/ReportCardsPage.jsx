// Term report cards: every published exam of a term combined by weight, with
// grades from the class's scale, position, attendance and comments.
// Staff pick a class; learners see their own card.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listClasses } from "@/api/classes.api";
import { useMe } from "@/hooks/useMe";
import { useCurrentTermState, useCurrentYearState, useSchoolCalendar } from "@/lib/schoolCalendar";
import { printSection } from "@/lib/print";
import PrintDocument from "@/components/print/PrintDocument";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const unwrap = (r) => r.data?.data;
const classLabel = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""}` : "");
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function ReportCard({ report, row, termLabel }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <div className="text-base font-semibold">
            {row.student.firstName} {row.student.lastName}
          </div>
          <div className="text-muted-foreground">
            Adm. no {row.student.admissionNo} · {classLabel(report.class)} · {termLabel} {report.year}
          </div>
        </div>
        <div className="text-right">
          <div>
            Position <b>{ordinal(row.position)}</b> of {report.outOf}
          </div>
          <div>
            Average <b>{row.average}</b> · Grade <b>{row.overallGrade || "—"}</b>
            {row.meanPoints != null && <> · Mean points <b>{row.meanPoints}</b></>}
          </div>
        </div>
      </div>

      {/* A column per exam can be wider than a phone: scroll the table, not the page. */}
      <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-1.5">Subject</th>
            {report.sessions.map((s) => (
              <th key={s.id} className="p-1.5 text-right">
                {s.name}
              </th>
            ))}
            <th className="p-1.5 text-right">Term</th>
            <th className="p-1.5 text-right">Grade</th>
            <th className="p-1.5">Remark</th>
          </tr>
        </thead>
        <tbody>
          {row.subjects.map((sub) => (
            <tr key={sub.subjectId} className="border-b">
              <td className="p-1.5">{sub.subjectName}</td>
              {report.sessions.map((s) => (
                <td key={s.id} className="p-1.5 text-right">
                  {sub.perSession[s.id] ?? "—"}
                </td>
              ))}
              <td className="p-1.5 text-right font-medium">{sub.termScore ?? "—"}</td>
              <td className="p-1.5 text-right">{sub.grade || "—"}</td>
              <td className="p-1.5">{sub.remark || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="text-xs text-muted-foreground">
        Grading: {report.gradeScale?.name}. Exams combined by weight: {report.sessions.map((s) => `${s.name} ×${s.weight}`).join(", ")}.
      </div>

      {row.attendance && (
        <div>
          Attendance: present {row.attendance.present + row.attendance.late} of {row.attendance.total} days
          {row.attendance.ratePct != null ? ` (${row.attendance.ratePct}%)` : ""}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="font-medium">Class teacher&apos;s comment</div>
          <div className="min-h-8">{row.comments.classTeacher || "—"}</div>
        </div>
        <div>
          <div className="font-medium">Head teacher&apos;s comment</div>
          <div className="min-h-8">{row.comments.head || "—"}</div>
        </div>
      </div>
    </div>
  );
}

function CommentsEditor({ row, year, term, canHead, onSaved }) {
  const [ct, setCt] = useState(row.comments.classTeacher);
  const [head, setHead] = useState(row.comments.head);
  const save = useMutation({
    mutationFn: () =>
      api.put("/api/exams/report-cards/comments", {
        studentId: row.student.id,
        year,
        term,
        classTeacherComment: ct,
        ...(canHead ? { headComment: head } : {}),
      }),
    onSuccess: () => {
      toast.success("Comments saved");
      onSaved();
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Could not save"),
  });
  return (
    <div className="space-y-2">
      <Input aria-label="Class teacher's comment" placeholder="Class teacher's comment" value={ct} onChange={(e) => setCt(e.target.value)} />
      {canHead && (
        <Input aria-label="Head teacher's comment" placeholder="Head teacher's comment" value={head} onChange={(e) => setHead(e.target.value)} />
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save comments
        </Button>
      </div>
    </div>
  );
}

export default function ReportCardsPage() {
  const qc = useQueryClient();
  const meQ = useMe();
  const role = meQ.data?.user?.role;
  // Learners see their own card; parents the child in the URL (/app/portal/:studentId/report-card).
  const { studentId: paramStudentId } = useParams();
  const myStudentId = paramStudentId || meQ.data?.user?.studentId;
  const isStudent = role === "STUDENT" || role === "PARENT";
  const { termLabels } = useSchoolCalendar();
  const [year, setYear] = useCurrentYearState();
  const [term, setTerm] = useCurrentTermState();
  const [classId, setClassId] = useState("");
  const [openId, setOpenId] = useState(null);

  const classesQ = useQuery({
    queryKey: ["classes", { year }],
    queryFn: () => listClasses({ year }),
    enabled: !isStudent && !!role,
  });
  const key = ["reportCards", { classId, year, term, me: isStudent ? myStudentId : null }];
  const reportQ = useQuery({
    queryKey: key,
    queryFn: () =>
      isStudent
        ? api.get(`/api/exams/report-cards/students/${myStudentId}`, { params: { year, term } }).then(unwrap)
        : api.get("/api/exams/report-cards", { params: { classId, year, term } }).then(unwrap),
    enabled: isStudent ? !!myStudentId : !!classId,
    retry: false,
  });

  const report = reportQ.data;
  const open = useMemo(() => report?.students.find((s) => s.student.id === openId) || null, [report, openId]);
  const termLabel = termLabels?.[term] || term;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Report cards</h1>
        <p className="text-muted-foreground text-sm">
          A term&apos;s published exams combined into one report per learner.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
          {!isStudent && (
            <select
              aria-label="Class"
              className="h-9 rounded-md border bg-background px-3 text-sm min-w-48"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setOpenId(null);
              }}
            >
              <option value="">Choose a class…</option>
              {(classesQ.data || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)} ({c.year})
                </option>
              ))}
            </select>
          )}
          <Input aria-label="Year" type="number" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <select aria-label="Term" className="h-9 rounded-md border bg-background px-3 text-sm" value={term} onChange={(e) => setTerm(e.target.value)}>
            {["TERM1", "TERM2", "TERM3"].map((t) => (
              <option key={t} value={t}>
                {termLabels?.[t] || t}
              </option>
            ))}
          </select>
          {report && !isStudent && report.students.length > 0 && (
            <Button variant="outline" onClick={() => printSection("print-all-report-cards")}>
              Print all
            </Button>
          )}
        </CardContent>
      </Card>

      {reportQ.isLoading && (isStudent || classId) && <div className="text-sm text-muted-foreground">Loading…</div>}
      {reportQ.isError && (
        <div className="text-sm text-muted-foreground">{reportQ.error?.response?.data?.message || "No report cards for this term yet."}</div>
      )}
      {report && report.students.length === 0 && (
        <div className="text-sm text-muted-foreground">No published exams for this class and term yet.</div>
      )}

      {report && !isStudent && report.students.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {classLabel(report.class)} · {termLabel} {report.year} · {report.sessions.length} exam(s)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-2">Pos.</th>
                  <th className="p-2">Learner</th>
                  <th className="p-2 text-right">Average</th>
                  <th className="p-2 text-right">Grade</th>
                  <th className="p-2 text-right">Attendance</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {report.students.map((r) => (
                  <tr key={r.student.id} className="border-t">
                    <td className="p-2">{r.position}</td>
                    <td className="p-2">
                      {r.student.firstName} {r.student.lastName} <span className="text-muted-foreground">({r.student.admissionNo})</span>
                    </td>
                    <td className="p-2 text-right">{r.average}</td>
                    <td className="p-2 text-right">{r.overallGrade || "—"}</td>
                    <td className="p-2 text-right">{r.attendance?.ratePct != null ? `${r.attendance.ratePct}%` : "—"}</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenId(openId === r.student.id ? null : r.student.id)}>
                        {openId === r.student.id ? "Close" : "Open"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {report && (isStudent ? report.students[0] : open) && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <ReportCard report={report} row={isStudent ? report.students[0] : open} termLabel={termLabel} />
            {!isStudent && (
              <CommentsEditor
                key={open.student.id}
                row={open}
                year={year}
                term={term}
                canHead={role === "ADMIN"}
                onSaved={() => qc.invalidateQueries({ queryKey: ["reportCards"] })}
              />
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => printSection("print-one-report-card")}>
                Print this card
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {report && (isStudent ? report.students[0] : open) && (
        <PrintDocument id="print-one-report-card">
          <ReportCard report={report} row={isStudent ? report.students[0] : open} termLabel={termLabel} />
        </PrintDocument>
      )}
      {report && !isStudent && (
        <PrintDocument id="print-all-report-cards">
          {report.students.map((r) => (
            <div key={r.student.id} style={{ breakAfter: "page" }}>
              <ReportCard report={report} row={r} termLabel={termLabel} />
            </div>
          ))}
        </PrintDocument>
      )}
    </div>
  );
}
