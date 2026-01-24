// src/features/exams/marks/MarksEntryPage.jsx
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMarkSheet,
  submitMarkSheet,
  unlockMarkSheet,
  upsertBulkMarks,
} from "@/api/exams.api";

import { listClasses } from "@/api/classes.api";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import MarksTable from "./MarksTable";
import UnlockReasonDialog from "./UnlockReasonDialog";

// ---------- helpers ----------
function clampTo100(n) {
  return Math.max(0, Math.min(100, n));
}

function normalizeScoreInput(raw) {
  if (raw === "" || raw === null || raw === undefined) return { ok: true, value: "" };
  const n = Number(raw);
  if (Number.isNaN(n)) return { ok: false, value: raw, message: "Must be a number" };
  if (n < 0 || n > 100) return { ok: false, value: raw, message: "Must be 0–100" };
  return { ok: true, value: raw };
}

function buildDraftFromMarks(marks = []) {
  const next = {};
  for (const m of marks) {
    next[m.studentId] = {
      score: m.score ?? "",
      isMissing: !!m.isMissing,
      comment: m.comment ?? "",
    };
  }
  return next;
}

function fmtClass(c) {
  if (!c) return "-";
  return `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`;
}

// Handles both shapes:
// A) { success:true, data:{...} }
// B) {...}
function unwrap(data) {
  if (!data) return null;
  if (typeof data === "object" && "data" in data) return data.data;
  return data;
}

function errMsg(err) {
  return err?.response?.data?.message || err?.message || "Request failed";
}

function is403(err) {
  return Number(err?.response?.status) === 403;
}

function is404(err) {
  return Number(err?.response?.status) === 404;
}

// ---------- component ----------
export default function MarksEntryPage() {
  const { marksheetId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: meData } = useMe();
  const role = meData?.user?.role;

  // unlock modal
  const [unlockOpen, setUnlockOpen] = useState(false);

  // track unsaved changes (lightweight)
  const [dirty, setDirty] = useState(false);

  // IMPORTANT: we avoid overwriting draft while user is typing
  const lastHydratedAtRef = useRef(null);

  // 1) load marksheet
  const msQ = useQuery({
    queryKey: ["markSheet", marksheetId],
    queryFn: () => getMarkSheet(marksheetId),
    enabled: Boolean(marksheetId),
    retry: false,
  });

  const marksheet = useMemo(() => unwrap(msQ.data), [msQ.data]);

  const status = marksheet?.status || "-";
  const isLocked = status === "SUBMITTED";

  const session = marksheet?.examSession;
  const sessionName = session?.name || "Exam Session";
  const classId = session?.classId;
  const year = session?.year;
  const term = session?.term;

  const marks = marksheet?.marks || [];

  // ✅ SMART: students are derived from marksheet.marks, not /api/students
  // This avoids "Forbidden: not your assigned class" turning into fake emptiness.
  const students = useMemo(() => {
    if (!Array.isArray(marks) || marks.length === 0) return [];
    // Prefer embedded student objects if present
    const list = marks.map((m) => m.student).filter(Boolean);
    // If student objects are missing (shouldn’t happen if your select includes them),
    // we return empty and show a clear message below.
    return list;
  }, [marks]);

  // 2) resolve class label (optional UX)
  const classesQ = useQuery({
    enabled: Boolean(year),
    queryKey: ["classes", { year }],
    queryFn: () => listClasses({ year }),
    retry: false,
  });

  const classLabel = useMemo(() => {
    const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
    const c = classes.find((x) => String(x.id) === String(classId));
    return c ? fmtClass(c) : (classId || "-");
  }, [classesQ.data, classId]);

  // 3) local draft
  const [draft, setDraftRaw] = useState({});

  // Wrap setDraft to mark dirty state
  const setDraft = useCallback((updater) => {
    setDraftRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next !== prev) setDirty(true);
      return next;
    });
  }, []);

  // Hydrate draft from marks ONLY when:
  // - first load OR server updatedAt changed
  // - and user is not currently dirty (don’t clobber typing)
  useEffect(() => {
    if (!marksheetId) return;

    const updatedAt = marksheet?.updatedAt || null;

    // If the user has unsaved changes, do not overwrite their draft.
    if (dirty) return;

    // Avoid re-hydrating with the same timestamp repeatedly
    if (updatedAt && lastHydratedAtRef.current === updatedAt) return;

    lastHydratedAtRef.current = updatedAt;

    if (!marksheet?.marks) {
      setDraftRaw({});
      return;
    }

    setDraftRaw(buildDraftFromMarks(marksheet.marks));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksheetId, marksheet?.updatedAt]);

  // 4) join rows
  const rows = useMemo(() => {
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    return (students || [])
      .map((s) => {
        const m = markByStudent.get(s.id);
        const d =
          draft[s.id] ??
          ({
            score: m?.score ?? "",
            isMissing: m ? !!m.isMissing : true,
            comment: m?.comment ?? "",
          });

        return { student: s, mark: m, draft: d };
      })
      .sort((a, b) =>
        String(a.student.admissionNo ?? "").localeCompare(
          String(b.student.admissionNo ?? "")
        )
      );
  }, [students, marks, draft]);

  const missingCount = useMemo(() => {
    return rows.filter((r) => {
      const d = r.draft;
      const scoreEmpty = d.score === "" || d.score === null || d.score === undefined;
      return d.isMissing || scoreEmpty;
    }).length;
  }, [rows]);

  const invalidCount = useMemo(() => {
    return rows.filter((r) => {
      const d = r.draft;

      // Missing rows are never invalid
      if (d.isMissing) return false;

      // Blank is NOT invalid — it's missing/pending
      if (d.score === "" || d.score === null || d.score === undefined) return false;

      const n = Number(d.score);
      return Number.isNaN(n) || n < 0 || n > 100;
    }).length;
  }, [rows]);

  const loading = msQ.isLoading || classesQ.isLoading;

  // 5) mutations
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        marks: rows.map((r) => {
          const d = r.draft;

          if (d.isMissing) {
            return {
              studentId: r.student.id,
              score: null,
              isMissing: true,
              comment: d.comment?.trim() ? d.comment.trim() : null,
            };
          }

          const n = Number(d.score);
          const safe = Number.isNaN(n) ? null : clampTo100(n);

          return {
            studentId: r.student.id,
            score: safe,
            isMissing: false,
            comment: d.comment?.trim() ? d.comment.trim() : null,
          };
        }),
      };

      return upsertBulkMarks(marksheetId, payload);
    },
    onSuccess: () => {
      // normalize UI values after save
      setDraftRaw((prev) => {
        const next = { ...prev };
        for (const [studentId, d] of Object.entries(next)) {
          if (!d || d.isMissing) continue;
          if (d.score === "" || d.score == null) continue;
          const n = Number(d.score);
          if (Number.isNaN(n)) continue;
          next[studentId] = { ...d, score: String(clampTo100(n)) };
        }
        return next;
      });

      setDirty(false);

      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"], exact: false });
      qc.invalidateQueries({ queryKey: ["classResults"], exact: false });
      qc.invalidateQueries({ queryKey: ["studentResults"], exact: false });
    },
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await saveMut.mutateAsync();
      }
      return submitMarkSheet(marksheetId);
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"], exact: false });
    },
  });

  const unlockMut = useMutation({
    mutationFn: (reason) => unlockMarkSheet(marksheetId, { reason }),
    onSuccess: () => {
      setUnlockOpen(false);
      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"], exact: false });
    },
  });

  const canSave = !loading && !isLocked && invalidCount === 0;
  const canSubmit = !loading && !isLocked && missingCount === 0 && invalidCount === 0;

  // ✅ Unsaved changes guard (refresh/close)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ✅ Optional: safer back navigation button
  const smartBack = useCallback(() => {
    if (!dirty) return navigate(-1);
    const ok = window.confirm("You have unsaved changes. Leave this page?");
    if (ok) navigate(-1);
  }, [dirty, navigate]);

  // ---------- error state ----------
  if (msQ.isError) {
    const msg = errMsg(msQ.error);
    const forbidden = is403(msQ.error);
    const notFound = is404(msQ.error);

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Marks Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm text-red-600">
              {notFound ? "MarkSheet not found." : forbidden ? "Access denied." : "Failed to load marksheet."}
            </div>
            <div className="text-sm opacity-70">{msg}</div>

            <div className="flex gap-2 pt-2">
              <Button asChild variant="outline">
                <Link to="/app/exams">Back to sessions</Link>
              </Button>
              <Button variant="outline" onClick={() => msQ.refetch()}>
                Retry
              </Button>
              <Button variant="outline" onClick={() => navigate(-1)}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------- main UI ----------
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>{sessionName}</CardTitle>

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant="secondary">{status}</Badge>

                <Badge variant={missingCount === 0 ? "default" : "destructive"}>
                  Missing: {missingCount}
                </Badge>

                <Badge variant={invalidCount === 0 ? "secondary" : "destructive"}>
                  Invalid: {invalidCount}
                </Badge>

                {dirty && <Badge variant="outline">Unsaved changes</Badge>}

                <span className="text-sm opacity-70">
                  {classLabel} • {term ?? "-"} {year ?? "-"} • /100
                </span>
              </div>
            </div>

            {/* Back buttons */}
            <div className="flex items-center gap-2">
              {session?.id && (
                <Button asChild variant="outline">
                  <Link to={`/app/exams/sessions/${session.id}/marksheets`}>
                    Back to marksheets
                  </Link>
                </Button>
              )}

              <Button asChild variant="outline">
                <Link to="/app/exams">Back to sessions</Link>
              </Button>

              <Button variant="outline" onClick={smartBack}>
                Back
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!canSave || saveMut.isPending}
          >
            {saveMut.isPending ? "Saving..." : "Save"}
          </Button>

          <Button
            variant="secondary"
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit || submitMut.isPending}
          >
            {submitMut.isPending ? "Submitting..." : (dirty ? "Save & Submit" : "Submit")}
          </Button>

          {role === "ADMIN" && (
            <>
              <Button
                variant="outline"
                onClick={() => setUnlockOpen(true)}
                disabled={loading || unlockMut.isPending || status !== "SUBMITTED"}
              >
                Unlock
              </Button>

              <UnlockReasonDialog
                open={unlockOpen}
                onOpenChange={setUnlockOpen}
                loading={unlockMut.isPending}
                onConfirm={(reason) => unlockMut.mutate(reason)}
              />
            </>
          )}

          {(saveMut.isError || submitMut.isError || unlockMut.isError) && (
            <div className="text-sm text-red-600">
              {saveMut.isError && `Save failed: ${errMsg(saveMut.error)}`}
              {submitMut.isError && ` Submit failed: ${errMsg(submitMut.error)}`}
              {unlockMut.isError && ` Unlock failed: ${errMsg(unlockMut.error)}`}
            </div>
          )}

          {invalidCount > 0 && (
            <div className="text-sm text-red-600">
              Some scores are invalid (must be 0–100). Blank scores are treated as Missing.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Smart empty state:
          If marks exist but student objects are missing, tell the truth. */}
      {!loading && Array.isArray(marks) && marks.length > 0 && students.length === 0 ? (
        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="font-medium">Students not available</div>
            <div className="text-sm opacity-70">
              This marksheet has marks, but student details were not included in the API response.
              Ensure <span className="font-mono">getMarkSheet</span> returns each mark with
              <span className="font-mono"> student </span> fields (id, admissionNo, firstName, lastName).
            </div>
          </CardContent>
        </Card>
      ) : null}

      <MarksTable
        loading={loading}
        isLocked={isLocked}
        rows={rows}
        setDraft={setDraft}
        normalizeScoreInput={normalizeScoreInput}
      />
    </div>
  );
}
