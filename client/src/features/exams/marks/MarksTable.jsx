// src/features/exams/marks/MarksTable.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fullName(s) {
  const a = String(s?.firstName || "").trim();
  const b = String(s?.lastName || "").trim();
  return `${a} ${b}`.trim() || "—";
}

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function isBlankScore(v) {
  return v === "" || v === null || v === undefined;
}

export default function MarksTable({
  loading,
  isLocked,
  rows,
  setDraft,
  normalizeScoreInput,
}) {
  const [q, setQ] = useState("");

  // refs for keyboard navigation
  const scoreRefs = useRef([]);
  const commentRefs = useRef([]);

  // keep refs aligned with visible rows length
  useEffect(() => {
    scoreRefs.current = scoreRefs.current.slice(0, rows.length);
    commentRefs.current = commentRefs.current.slice(0, rows.length);
  }, [rows.length]);

  const filtered = useMemo(() => {
    const needle = safeLower(q).trim();
    if (!needle) return rows;

    return rows.filter((r) => {
      const ad = safeLower(r.student?.admissionNo);
      const nm = safeLower(fullName(r.student));
      return ad.includes(needle) || nm.includes(needle);
    });
  }, [rows, q]);

  const focusScore = useCallback((idx) => {
    const el = scoreRefs.current[idx];
    if (el && typeof el.focus === "function") {
      el.focus();
      try {
        el.select?.();
      } catch {}
    }
  }, []);

  const focusPrev = useCallback(
    (idx) => {
      const next = Math.max(0, idx - 1);
      focusScore(next);
    },
    [focusScore]
  );

  const focusNext = useCallback(
    (idx) => {
      const next = Math.min(filtered.length - 1, idx + 1);
      focusScore(next);
    },
    [filtered.length, focusScore]
  );

  // Bulk actions operate on FILTERED rows (better UX)
  const bulkSetMissing = useCallback(
    (missing) => {
      if (isLocked) return;
      setDraft((prev) => {
        const next = { ...prev };
        for (const r of filtered) {
          const sid = r.student.id;
          const cur = next[sid] || r.draft || {};
          next[sid] = {
            ...cur,
            isMissing: !!missing,
            // if marking missing, blank the score (keeps semantics clean)
            score: missing ? "" : (isBlankScore(cur.score) ? "" : cur.score),
          };
        }
        return next;
      });
    },
    [filtered, isLocked, setDraft]
  );

  const autoMissing = useCallback(() => {
    if (isLocked) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const r of filtered) {
        const sid = r.student.id;
        const cur = next[sid] || r.draft || {};
        const blank = isBlankScore(cur.score);
        next[sid] = { ...cur, isMissing: blank };
      }
      return next;
    });
  }, [filtered, isLocked, setDraft]);

  const onScoreChange = useCallback(
    (row, value) => {
      if (isLocked) return;

      const n = normalizeScoreInput(value);
      if (!n.ok) {
        // still store raw input so user can correct it
        setDraft((prev) => ({
          ...prev,
          [row.student.id]: {
            ...(prev[row.student.id] || row.draft),
            score: value,
            isMissing: false,
          },
        }));
        return;
      }

      setDraft((prev) => {
        const cur = prev[row.student.id] || row.draft || {};
        const blank = isBlankScore(value);

        return {
          ...prev,
          [row.student.id]: {
            ...cur,
            score: value,
            // smart default: if score is blank, mark missing, else present
            isMissing: blank ? true : false,
          },
        };
      });
    },
    [isLocked, normalizeScoreInput, setDraft]
  );

  const toggleMissing = useCallback(
    (row) => {
      if (isLocked) return;
      setDraft((prev) => {
        const cur = prev[row.student.id] || row.draft || {};
        const nextMissing = !cur.isMissing;

        return {
          ...prev,
          [row.student.id]: {
            ...cur,
            isMissing: nextMissing,
            // if switched to missing, blank the score (cleaner)
            score: nextMissing ? "" : cur.score,
          },
        };
      });
    },
    [isLocked, setDraft]
  );

  const onCommentChange = useCallback(
    (row, value) => {
      if (isLocked) return;
      setDraft((prev) => ({
        ...prev,
        [row.student.id]: {
          ...(prev[row.student.id] || row.draft),
          comment: value,
        },
      }));
    },
    [isLocked, setDraft]
  );

  const onScoreKeyDown = useCallback(
    (e, idx) => {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        focusNext(idx);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusPrev(idx);
      }
    },
    [focusNext, focusPrev]
  );

  const onRowKeyDown = useCallback(
    (e, idx, row) => {
      // quick toggles
      if (e.key.toLowerCase() === "m") {
        // "m" toggle missing
        e.preventDefault();
        toggleMissing(row);
      }
      if (e.key === "Escape") {
        // bounce focus back to score
        e.preventDefault();
        focusScore(idx);
      }
    },
    [toggleMissing, focusScore]
  );

  // ---------- UI ----------
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="font-medium">Marks</div>
            <div className="text-xs text-muted-foreground">
              {filtered.length} students • Enter/↓ next • ↑ previous • Press <span className="font-medium">M</span> to toggle Missing
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search admission no / name"
              className="h-9 w-full sm:w-[260px]"
              disabled={loading}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-9"
                onClick={() => bulkSetMissing(false)}
                disabled={loading || isLocked || filtered.length === 0}
                title="Sets Missing = false for filtered rows"
              >
                Mark all present
              </Button>
              <Button
                variant="outline"
                className="h-9"
                onClick={() => bulkSetMissing(true)}
                disabled={loading || isLocked || filtered.length === 0}
                title="Sets Missing = true for filtered rows"
              >
                Mark all missing
              </Button>
              <Button
                variant="outline"
                className="h-9"
                onClick={autoMissing}
                disabled={loading || isLocked || filtered.length === 0}
                title="Blank score = Missing, score entered = Present"
              >
                Auto missing (blank)
              </Button>
            </div>
          </div>
        </div>

        {/* States */}
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading marks…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No rows available for this marksheet.</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">No matches for “{q}”.</div>
        ) : null}

        {/* Table */}
        {filtered.length > 0 ? (
          <div className="overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr className="text-left">
                  <th className="px-3 py-2 w-[110px]">Adm No</th>
                  <th className="px-3 py-2 min-w-[220px]">Student</th>
                  <th className="px-3 py-2 w-[140px]">Score (/100)</th>
                  <th className="px-3 py-2 w-[140px]">Missing</th>
                  <th className="px-3 py-2 min-w-[240px]">Comment</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((r, idx) => {
                  const s = r.student;
                  const d = r.draft || {};
                  const missing = !!d.isMissing;

                  const scoreVal = d.score ?? "";
                  const normalized = normalizeScoreInput(scoreVal);
                  const scoreInvalid = !missing && !isBlankScore(scoreVal) && !normalized.ok;

                  return (
                    <tr
                      key={s.id}
                      className="border-b last:border-b-0 hover:bg-muted/40"
                      onKeyDown={(e) => onRowKeyDown(e, idx, r)}
                      tabIndex={-1}
                    >
                      <td className="px-3 py-2 font-medium">{s.admissionNo || "—"}</td>

                      <td className="px-3 py-2">
                        <div className="font-medium">{fullName(s)}</div>
                        <div className="text-xs text-muted-foreground">{s.gender || ""}</div>
                      </td>

                      <td className="px-3 py-2">
                        <Input
                          ref={(el) => (scoreRefs.current[idx] = el)}
                          value={scoreVal}
                          onChange={(e) => onScoreChange(r, e.target.value)}
                          onKeyDown={(e) => onScoreKeyDown(e, idx)}
                          disabled={isLocked}
                          placeholder={missing ? "Missing" : "0–100"}
                          className={[
                            "h-9",
                            missing ? "opacity-70" : "",
                            scoreInvalid ? "border-red-500 focus-visible:ring-red-500" : "",
                          ].join(" ")}
                          inputMode="numeric"
                        />
                        {scoreInvalid ? (
                          <div className="text-[11px] text-red-600 mt-1">
                            {normalized.message || "Invalid score"}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => toggleMissing(r)}
                          className={[
                            "w-full h-9 rounded-md border px-3 text-left flex items-center justify-between",
                            missing ? "bg-muted" : "bg-background hover:bg-muted/40",
                            isLocked ? "opacity-60 cursor-not-allowed" : "",
                          ].join(" ")}
                          title="Click to toggle missing (shortcut: M)"
                        >
                          <span className="font-medium">{missing ? "YES" : "NO"}</span>
                          <span className="text-xs text-muted-foreground">
                            {missing ? "Missing" : "Present"}
                          </span>
                        </button>
                      </td>

                      <td className="px-3 py-2">
                        <Input
                          ref={(el) => (commentRefs.current[idx] = el)}
                          value={d.comment ?? ""}
                          onChange={(e) => onCommentChange(r, e.target.value)}
                          disabled={isLocked}
                          placeholder="Optional…"
                          className="h-9"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {isLocked ? (
          <div className="text-xs text-muted-foreground">
            This marksheet is <span className="font-medium">SUBMITTED</span>. Editing is locked.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
