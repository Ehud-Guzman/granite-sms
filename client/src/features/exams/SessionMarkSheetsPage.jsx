// src/features/exams/SessionMarkSheetsPage.jsx
import { useMemo, useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listSessionMarkSheets, publishResults } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { useMe } from "@/hooks/useMe";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function badgeVariant(status) {
  if (status === "PUBLISHED") return "default";
  if (status === "SUBMITTED") return "secondary";
  if (status === "UNLOCKED") return "secondary";
  if (status === "DRAFT") return "outline";
  return "secondary";
}

function fmtClass(c) {
  if (!c) return "-";
  return `${c.name}${c.stream ? ` ${c.stream}` : ""}${c.year ? ` (${c.year})` : ""}`;
}

function errMsg(err) {
  return err?.response?.data?.message || err?.message || "Request failed";
}

function unwrapMarksheetsResponse(resp) {
  // Supports BOTH shapes:
  // A) { success: true, data: { session, markSheets } }
  // B) { session, markSheets }
  if (!resp) return { session: null, markSheets: [] };

  const payload =
    resp?.data && typeof resp.data === "object" && (resp.data.session || resp.data.markSheets)
      ? resp.data
      : resp;

  return {
    session: payload?.session ?? null,
    markSheets: Array.isArray(payload?.markSheets) ? payload.markSheets : [],
  };
}

export default function SessionMarkSheetsPage() {
  const { sessionId } = useParams();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState(null); // { type: "success"|"error", message }

  const { data: meData } = useMe();
  const role = meData?.user?.role;

  // Reset UI feedback when session changes
  useEffect(() => {
    setNotice(null);
    setSearch("");
  }, [sessionId]);

  const q = useQuery({
    queryKey: ["sessionMarkSheets", sessionId],
    queryFn: () => listSessionMarkSheets(sessionId),
    enabled: Boolean(sessionId),
  });

  const { session, markSheets } = useMemo(
    () => unwrapMarksheetsResponse(q.data),
    [q.data]
  );

  const year = session?.year;
  const term = session?.term;
  const classId = session?.classId;

  // Resolve class label
  const classesQ = useQuery({
    enabled: Boolean(year),
    queryKey: ["classes", { year }],
    queryFn: () => listClasses({ year }),
  });

  const classLabel = useMemo(() => {
    const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
    const c = classes.find((x) => String(x.id) === String(classId));
    return c ? fmtClass(c) : classId || "-";
  }, [classesQ.data, classId]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return markSheets;

    return markSheets.filter((m) => {
      const subj = `${m.subject?.name ?? ""} ${m.subject?.code ?? ""}`.toLowerCase();
      const st = String(m.status || "").toLowerCase();
      const miss = String(m.missingCount ?? "").toLowerCase();
      return subj.includes(s) || st.includes(s) || miss.includes(s);
    });
  }, [markSheets, search]);

  const headerTitle = session?.name || "Exam Session";

  // --- publish readiness ---
  const total = markSheets.length;

  const submittedCount = useMemo(
    () => markSheets.filter((m) => m.status === "SUBMITTED").length,
    [markSheets]
  );

  const anyUnlocked = useMemo(
    () => markSheets.some((m) => m.status === "UNLOCKED"),
    [markSheets]
  );

  const anyDraft = useMemo(
    () => markSheets.some((m) => m.status === "DRAFT"),
    [markSheets]
  );

  const allSubmitted = total > 0 && submittedCount === total;
  const sessionStatus = session?.status || "-";
  const isAlreadyPublished = sessionStatus === "PUBLISHED";

  const publishDisabledReason = (() => {
    if (role !== "ADMIN") return "Admins only";
    if (isAlreadyPublished) return "Already published";
    if (total === 0) return "No marksheets in this session";
    if (anyUnlocked) return "Some marksheets are UNLOCKED (re-submit them)";
    if (anyDraft) return `Some marksheets are still DRAFT (${submittedCount}/${total})`;
    if (!allSubmitted) return `Submit all marksheets first (${submittedCount}/${total})`;
    return null;
  })();

  const canPublish =
    role === "ADMIN" &&
    Boolean(sessionId) &&
    !q.isLoading &&
    !isAlreadyPublished &&
    allSubmitted &&
    !anyUnlocked;

  // Publish mutation (ADMIN)
  const pubMut = useMutation({
    mutationFn: () => publishResults(sessionId),
    onSuccess: () => {
      setNotice({
        type: "success",
        message: "Published successfully ✅ Results are now visible to students.",
      });

      // Refresh marksheets + sessions + results caches
      qc.invalidateQueries({ queryKey: ["sessionMarkSheets", sessionId] });
      qc.invalidateQueries({ queryKey: ["examSessions"], exact: false });
      qc.invalidateQueries({ queryKey: ["classResults"], exact: false });
      qc.invalidateQueries({ queryKey: ["studentResults"], exact: false });

      // reports (future-proof)
      qc.invalidateQueries({ queryKey: ["classReport"], exact: false });
      qc.invalidateQueries({ queryKey: ["subjectReport"], exact: false });
      qc.invalidateQueries({ queryKey: ["studentReport"], exact: false });
      qc.invalidateQueries({ queryKey: ["reports"], exact: false });
    },
    onError: (err) => {
      setNotice({ type: "error", message: `Publish failed: ${errMsg(err)}` });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>{headerTitle}</CardTitle>

              <div className="text-sm opacity-70 mt-1">
                Year: {year ?? "-"} • Term: {term ?? "-"} • Class:{" "}
                {classesQ.isLoading ? "Loading class…" : classLabel} • Status:{" "}
                <span className="font-medium">{sessionStatus}</span>
              </div>

              <div className="text-xs opacity-70 mt-2 flex flex-wrap gap-2 items-center">
                <span>
                  Submitted: <span className="font-medium">{submittedCount}</span> /{" "}
                  <span className="font-medium">{total}</span>
                </span>

                {anyUnlocked && (
                  <span className="text-red-600">
                    Some marksheets are UNLOCKED — re-submit them before publishing.
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={badgeVariant(sessionStatus)}>{sessionStatus}</Badge>

              {role === "ADMIN" && (
                <Button
                  onClick={() => pubMut.mutate()}
                  disabled={!canPublish || pubMut.isPending}
                  title={publishDisabledReason || "Publish results for this session"}
                >
                  {pubMut.isPending ? "Publishing..." : "Publish Results"}
                </Button>
              )}

              <Button asChild variant="outline">
                <Link to="/app/exams">Back to sessions</Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {notice && (
            <div
              className={`text-sm rounded border px-3 py-2 ${
                notice.type === "success" ? "text-green-700" : "text-red-600"
              }`}
            >
              {notice.message}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by subject / status / missing…"
              className="min-w-[240px] flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setSearch("")}
              disabled={!search.trim()}
            >
              Clear
            </Button>
          </div>

          <Separator />

          {q.isLoading && <div className="opacity-70">Loading marksheets…</div>}

          {q.isError && (
            <div className="text-red-600">
              Failed to load marksheets: {errMsg(q.error)}
            </div>
          )}

          {classesQ.isError && (
            <div className="text-sm text-red-600">
              Failed to load classes: {errMsg(classesQ.error)}
            </div>
          )}

          {!q.isLoading && !q.isError && (
            <div className="text-xs opacity-70">
              Showing <span className="font-medium">{filtered.length}</span> of{" "}
              <span className="font-medium">{markSheets.length}</span> marksheets
            </div>
          )}

          {!q.isLoading && !q.isError && filtered.length === 0 && (
            <div className="opacity-70">No marksheets found.</div>
          )}

          <div className="grid gap-3">
            {filtered.map((m) => (
              <Card key={m.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium">
                      {m.subject?.name || "Subject"}{" "}
                      {m.subject?.code ? `(${m.subject.code})` : ""}
                    </div>

                    <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
                      <Badge variant={badgeVariant(m.status)}>{m.status}</Badge>

                      {typeof m.missingCount === "number" && (
                        <span>Missing: {m.missingCount}</span>
                      )}

                      {m.status === "UNLOCKED" && m.unlockReason && (
                        <span>Reason: {m.unlockReason}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button asChild variant="secondary">
                      <Link to={`/app/exams/marksheets/${m.id}/marks-entry`}>Enter Marks</Link>

                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
