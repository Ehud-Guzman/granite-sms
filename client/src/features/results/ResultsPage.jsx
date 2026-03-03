// src/features/results/ResultsPage.jsx
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/useMe";
import { listExamSessions, publishResults } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { listStudents } from "@/api/students.api";
import { getClassResults, getStudentResults } from "@/api/results.api";
import { getBranding } from "@/api/settingsBranding.api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import ResultsFilters from "./components/ResultsFilters";
import SessionsList from "./components/SessionsList";
import ClassResultsCard from "./components/ClassResultsCard";
import ClassResultsTable from "./components/ClassResultsTable";
import StudentSlipPanel from "./components/StudentSlipPanel";

import { fmtClass } from "./utils/format";
import { printNow } from "./utils/print";

function currentYear() {
  return new Date().getFullYear();
}

function errMsg(err) {
  return err?.response?.data?.message || err?.message || "Request failed";
}

export default function ResultsPage() {
  const qc = useQueryClient();
  const { data: meData, isLoading: meLoading } = useMe();

  const role = meData?.user?.role;
  const myStudentId = meData?.user?.studentId || null;
  const schoolName =
    meData?.user?.school?.name || meData?.school?.name || "-";

  /* ================= STATE ================= */
  const [year, setYear] = useState(String(currentYear()));
  const [term, setTerm] = useState("ALL");
  const [search, setSearch] = useState("");

  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState(null);

  const [showGrades, setShowGrades] = useState(true);
  const [toast, setToast] = useState(null);

  const yearNum = useMemo(
    () => (year ? Number(year) : undefined),
    [year]
  );

  /* ================= BRANDING ================= */
  const { data: branding } = useQuery({
    queryKey: ["branding"],
    queryFn: getBranding,
    staleTime: 5 * 60 * 1000,
  });

  /* ================= MUTATION (FIXED POSITION) ================= */
  const publishMut = useMutation({
    mutationFn: () => publishResults(activeSessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["examSessions"] });
      qc.invalidateQueries({ queryKey: ["classResults", activeSessionId] });
      qc.invalidateQueries({ queryKey: ["studentResults"] });
      setToast({ type: "success", message: "Results published ✅" });
    },
    onError: (err) =>
      setToast({
        type: "error",
        message: errMsg(err) || "Publish failed.",
      }),
  });

  /* ================= SESSIONS ================= */
  const sessionsQ = useQuery({
    enabled: !!yearNum,
    queryKey: ["examSessions", { year: yearNum, term }],
    queryFn: () => {
      const params = { year: yearNum };
      if (term !== "ALL") params.term = term;
      return listExamSessions(params);
    },
  });

  const sessions = useMemo(
    () => (Array.isArray(sessionsQ.data) ? sessionsQ.data : []),
    [sessionsQ.data]
  );

  const classesQ = useQuery({
    enabled: !!yearNum,
    queryKey: ["classes", { year: yearNum }],
    queryFn: () => listClasses({ year: yearNum }),
  });

  const classLabelById = useMemo(() => {
    const arr = Array.isArray(classesQ.data) ? classesQ.data : [];
    const map = new Map();
    arr.forEach((c) => map.set(c.id, fmtClass(c)));
    return map;
  }, [classesQ.data]);

  const filteredSessions = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return sessions;

    return sessions.filter((x) => {
      const name = String(x.name || "").toLowerCase();
      const type = String(x.examType?.name || "").toLowerCase();
      const cls = String(classLabelById.get(x.classId) || "").toLowerCase();
      return name.includes(s) || type.includes(s) || cls.includes(s);
    });
  }, [sessions, search, classLabelById]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (!sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(null);
      setActiveStudentId(null);
    }
  }, [sessions, activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  /* ================= CLASS RESULTS ================= */
  const classResultsQ = useQuery({
    enabled: !!activeSessionId && (role === "ADMIN" || role === "TEACHER"),
    queryKey: ["classResults", activeSessionId],
    queryFn: () => getClassResults(activeSessionId),
  });

  const classPayload =
    classResultsQ.data?.data || classResultsQ.data || null;

  const classId =
    classPayload?.session?.classId ||
    activeSession?.classId ||
    null;

  const studentsQ = useQuery({
    enabled: !!classId && (role === "ADMIN" || role === "TEACHER"),
    queryKey: ["students", { classId, active: true }],
    queryFn: () => listStudents({ classId, active: true }),
  });

  const studentsById = useMemo(() => {
    if (!Array.isArray(studentsQ.data)) return {};
    return studentsQ.data.reduce((acc, s) => {
      acc[s.id] = s;
      return acc;
    }, {});
  }, [studentsQ.data]);

  /* ================= STUDENT RESULTS ================= */
  const effectiveStudentId =
    role === "STUDENT" ? myStudentId : activeStudentId;

  const studentResultsQ = useQuery({
    enabled: !!activeSessionId && !!effectiveStudentId,
    queryKey: ["studentResults", activeSessionId, effectiveStudentId],
    queryFn: () =>
      getStudentResults(activeSessionId, effectiveStudentId),
  });

  /* ================= DERIVED ================= */
  const sessionName =
    activeSession?.name ||
    classPayload?.session?.name ||
    studentResultsQ.data?.data?.session?.name ||
    "Session";

  const sessionStatus =
    classPayload?.session?.status ||
    studentResultsQ.data?.data?.session?.status ||
    activeSession?.status ||
    "-";

  const sessionTerm =
    classPayload?.session?.term ||
    activeSession?.term ||
    term;

  const sessionYear =
    classPayload?.session?.year ||
    activeSession?.year ||
    yearNum;

  const activeClassLabel = useMemo(() => {
    const cid =
      classPayload?.session?.classId ||
      activeSession?.classId;
    return classLabelById.get(cid) || cid || "-";
  }, [classPayload, activeSession, classLabelById]);

  const gradingMeta =
    classPayload?.meta?.grading ||
    studentResultsQ.data?.data?.meta?.grading;

  const canPrintClass =
    (role === "ADMIN" || role === "TEACHER") &&
    !!activeSessionId &&
    !!classPayload &&
    !classResultsQ.isLoading;

  const canPrintStudent =
    !!activeSessionId &&
    !!effectiveStudentId &&
    !!studentResultsQ.data?.data &&
    !studentResultsQ.isLoading;

  const canPublish =
    role === "ADMIN" &&
    !!activeSessionId &&
    sessionStatus !== "PUBLISHED" &&
    !publishMut.isPending;

  /* ================= HANDLERS ================= */
  const onOpenSession = (id) => {
    setActiveSessionId(id);
    setActiveStudentId(null);
    setToast(null);
  };

  const onPrintClass = () => {
    if (!canPrintClass) {
      return setToast({
        type: "error",
        message: "Open class results first.",
      });
    }
    printNow("print-class-results");
  };

  const isLoadingProfile = meLoading || !role;

  return (
    <div className="space-y-4">
      {isLoadingProfile ? (
        <div className="text-center py-12 opacity-70">Loading user profile...</div>
      ) : (
        <>
          <Card className="no-print">
            <CardHeader className="space-y-1">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle>Results</CardTitle>
                  <div className="text-sm opacity-70">
                    Select an exam session, then view class results or a student’s results.
                  </div>
                </div>

                {role === "ADMIN" && activeSessionId && (
                  <Button
                    onClick={() => publishMut.mutate()}
                    disabled={!canPublish}
                    title={sessionStatus === "PUBLISHED" ? "Already published" : "Publish results"}
                  >
                    {publishMut.isPending ? "Publishing..." : "Publish"}
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {toast && (
                <div
                  className={`text-sm rounded border px-3 py-2 ${
                    toast.type === "success" ? "text-green-700 bg-green-50" : "text-red-600 bg-red-50"
                  }`}
                >
                  {toast.message}
                </div>
              )}

              <ResultsFilters
                year={year}
                setYear={setYear}
                term={term}
                setTerm={setTerm}
                search={search}
                setSearch={setSearch}
                showGrades={showGrades}
                setShowGrades={setShowGrades}
              />

              {sessionsQ.isLoading && <div className="opacity-70">Loading sessions…</div>}
              {sessionsQ.isError && (
                <div className="text-red-600">Failed to load sessions: {errMsg(sessionsQ.error)}</div>
              )}

              {!sessionsQ.isLoading && !sessionsQ.isError && filteredSessions.length === 0 && (
                <div className="opacity-70">No sessions found for these filters.</div>
              )}

              <SessionsList
                sessions={filteredSessions}
                activeSessionId={activeSessionId}
                onOpen={onOpenSession}
                classLabelById={classLabelById}
              />
            </CardContent>
          </Card>

          {/* Class results (Admin/Teacher) */}
          {role !== "STUDENT" && activeSessionId && (
            <ClassResultsCard
              schoolName={schoolName}
              sessionName={sessionName}
              classLabel={activeClassLabel}
              term={sessionTerm}
              year={sessionYear}
              status={sessionStatus}
              gradingMode={gradingMeta?.mode}
              role={role}
              canPrintClass={canPrintClass}
              onPrintClass={onPrintClass}
              canPublish={canPublish}
              publishing={publishMut.isPending}
              onPublish={() => publishMut.mutate()}

              logoUrl={branding?.brandLogoUrl}  // ← Pass logo here
              motto="Excellence in Education • Discipline • Service"
              examType="End Term"
            >
              {classResultsQ.isLoading && (
                <div className="opacity-70 py-8 text-center">Loading class results…</div>
              )}
              {classResultsQ.isError && (
                <div className="text-red-600 py-8 text-center">
                  Failed to load class results: {errMsg(classResultsQ.error)}
                </div>
              )}

              {classPayload ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 no-print mb-4">
                    <span className="text-sm opacity-70">Student</span>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm min-w-[260px]"
                      value={activeStudentId || ""}
                      onChange={(e) => setActiveStudentId(e.target.value || null)}
                    >
                      <option value="">(Optional) View student…</option>
                      {(studentsQ.data || []).map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.admissionNo || "—"} — {st.firstName} {st.lastName}
                        </option>
                      ))}
                    </select>

                    {studentsQ.isLoading && <span className="text-sm opacity-70 ml-2">Loading students…</span>}
                    {studentsQ.isError && (
                      <span className="text-sm text-red-600 ml-2">Failed to load students</span>
                    )}
                  </div>

                  {studentsQ.isSuccess && !studentsQ.data?.length && (
                    <div className="text-sm text-amber-600 mb-3">
                      No active students found in this class.
                    </div>
                  )}

                  <ClassResultsTable
                    classPayload={classPayload}
                    showGrades={showGrades}
                    students={studentsById}
                    logoUrl={branding?.brandLogoUrl}  // ← Pass logo here too
                  />
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/30">
                  No class results data available yet.
                  <br />
                  <span className="text-xs">
                    (Marks may not have been entered/submitted for all subjects)
                  </span>
                </div>
              )}
            </ClassResultsCard>
          )}

          {/* Student slip section (unchanged) */}
          {activeSessionId && (
            <>
              {role === "STUDENT" ? (
                <>
                  {!myStudentId && (
                    <Card>
                      <CardContent className="p-4 text-red-600">
                        Your account has no studentId linked. Fix `/api/me` for students.
                      </CardContent>
                    </Card>
                  )}

                  {studentResultsQ.isError && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-red-600 font-medium">Results unavailable.</div>
                        <div className="text-sm opacity-70 mt-1">
                          If results aren’t published yet, you won’t see them. Check with the admin.
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {myStudentId && studentResultsQ.data?.data && (
                    <StudentSlipPanel
                      payload={studentResultsQ.data.data}
                      classLabel={activeClassLabel}
                      showGrades={showGrades}
                      schoolName={schoolName}
                      sessionName={sessionName}
                      canPrint={canPrintStudent}
                      buttonLabel="Print My Slip"
                    />
                  )}

                  {studentResultsQ.isLoading && <div className="opacity-70">Loading your results…</div>}
                </>
              ) : (
                <>
                  {activeStudentId && studentResultsQ.data?.data && (
                    <StudentSlipPanel
                      payload={studentResultsQ.data.data}
                      classLabel={activeClassLabel}
                      showGrades={showGrades}
                      schoolName={schoolName}
                      sessionName={sessionName}
                      canPrint={canPrintStudent}
                      buttonLabel="Print Student Slip"
                    />
                  )}

                  {activeStudentId && studentResultsQ.isLoading && (
                    <div className="opacity-70">Loading student results…</div>
                  )}

                  {activeStudentId && studentResultsQ.isError && (
                    <div className="text-red-600">
                      Failed to load student results: {errMsg(studentResultsQ.error)}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}