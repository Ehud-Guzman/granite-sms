import { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMarkSheet,
  submitMarkSheet,
  unlockMarkSheet,
  upsertBulkMarks,
} from "@/api/exams.api";
import { listStudents } from "@/api/students.api";
import { useMe } from "@/hooks/useMe";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

// ---------- helpers ----------
function clampScore(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
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

function fmtName(s) {
  return `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || "-";
}

// ---------- component ----------
export default function MarkSheetPage() {
  const { marksheetId } = useParams();
  const qc = useQueryClient();

  const { data: meData } = useMe();
  const role = meData?.user?.role;

  // 1) Load marksheet
  const msQ = useQuery({
    queryKey: ["markSheet", marksheetId],
    queryFn: () => getMarkSheet(marksheetId),
  });

  const marksheet = msQ.data?.data;
  const status = marksheet?.status || "-";
  const isLocked = status === "SUBMITTED";

  const classId = marksheet?.examSession?.classId;
  const marks = marksheet?.marks || [];

  // 2) Load students in the class (for names/admissionNo)
  const studentsQ = useQuery({
    enabled: !!classId,
    queryKey: ["students", { classId, active: true }],
    queryFn: () => listStudents({ classId, active: true }),
  });

  const students = studentsQ.data || [];

  // 3) Local editable state (draft), reset ONLY when marksheetId changes
  const [draft, setDraft] = useState({});

  useEffect(() => {
    // Reset draft when you navigate to a different marksheet
    if (!marksheetId) return;
    if (!marksheet?.marks) {
      setDraft({});
      return;
    }
    setDraft(buildDraftFromMarks(marksheet.marks));
    // Intentionally reset only on marksheetId to avoid wiping edits on refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksheetId]);

  // 4) Join students + marks + draft for table rows
  const rows = useMemo(() => {
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    return students
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

  // 5) Mutations
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        marks: rows.map((r) => ({
          studentId: r.student.id,
          score: r.draft.isMissing ? null : clampScore(r.draft.score),
          isMissing: !!r.draft.isMissing,
          comment: r.draft.comment?.trim() ? r.draft.comment.trim() : null,
        })),
      };
      return upsertBulkMarks(marksheetId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      // refresh marksheets list counters (missingCount badges etc.)
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"] });
    },
  });

  const submitMut = useMutation({
    mutationFn: () => submitMarkSheet(marksheetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"] });
    },
  });

  const unlockMut = useMutation({
    mutationFn: () => unlockMarkSheet(marksheetId, { unlockReason: "Correction" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markSheet", marksheetId] });
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets"] });
    },
  });

  // 6) UI
  const loading = msQ.isLoading || (classId && studentsQ.isLoading);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>MarkSheet</CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{status}</Badge>

            <Badge variant={missingCount === 0 ? "default" : "destructive"}>
              Missing: {missingCount}
            </Badge>

            <span className="text-sm opacity-70">
              Term: {marksheet?.examSession?.term ?? "-"} • Year:{" "}
              {marksheet?.examSession?.year ?? "-"} • /100
            </span>
          </div>
        </CardHeader>

        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={loading || isLocked || saveMut.isPending}
          >
            {saveMut.isPending ? "Saving..." : "Save"}
          </Button>

          <Button
            variant="secondary"
            onClick={() => submitMut.mutate()}
            disabled={
              loading || isLocked || submitMut.isPending || missingCount > 0
            }
          >
            {submitMut.isPending ? "Submitting..." : "Submit"}
          </Button>

          {role === "ADMIN" && (
            <Button
              variant="outline"
              onClick={() => unlockMut.mutate()}
              disabled={loading || unlockMut.isPending || status !== "SUBMITTED"}
            >
              {unlockMut.isPending ? "Unlocking..." : "Unlock"}
            </Button>
          )}

          {missingCount > 0 && (
            <div className="text-sm opacity-70">
              Fill all scores (or mark Missing) before submitting.
            </div>
          )}

          {msQ.isError && (
            <div className="text-sm text-red-600">Failed to load marksheet.</div>
          )}
          {studentsQ.isError && (
            <div className="text-sm text-red-600">Failed to load students.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marks</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {loading && <div className="opacity-70">Loading…</div>}

          {!loading && rows.length === 0 && (
            <div className="opacity-70">No students found for this class.</div>
          )}

          <div className="grid gap-2">
            {rows.map(({ student, draft: d }) => {
              const scoreDisabled = isLocked || d.isMissing;

              return (
                <div key={student.id} className="border rounded p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{fmtName(student)}</div>
                      <div className="text-xs opacity-70">
                        Adm: {student.admissionNo ?? "-"}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!d.isMissing}
                          disabled={isLocked}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDraft((prev) => ({
                              ...prev,
                              [student.id]: {
                                ...d,
                                isMissing: checked,
                                score: checked ? "" : d.score,
                              },
                            }));
                          }}
                        />
                        Missing
                      </label>

                      <Input
                        className="w-24"
                        placeholder="0-100"
                        value={d.score}
                        disabled={scoreDisabled}
                        onChange={(e) => {
                          const val = e.target.value;
                          // allow empty while typing
                          if (val === "") {
                            setDraft((prev) => ({
                              ...prev,
                              [student.id]: { ...d, score: "" },
                            }));
                            return;
                          }
                          // allow numeric typing
                          if (!/^\d+(\.\d+)?$/.test(val)) return;

                          setDraft((prev) => ({
                            ...prev,
                            [student.id]: { ...d, score: val },
                          }));
                        }}
                      />
                    </div>
                  </div>

                  <Separator className="my-2" />

                  <Input
                    placeholder="Comment (optional)"
                    value={d.comment}
                    disabled={isLocked}
                    onChange={(e) => {
                      setDraft((prev) => ({
                        ...prev,
                        [student.id]: { ...d, comment: e.target.value },
                      }));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
