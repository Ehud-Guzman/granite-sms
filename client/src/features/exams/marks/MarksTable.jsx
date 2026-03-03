// src/features/exams/marks/MarksTable.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

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
  rows,                    // backend guarantees only active students
  setDraft,
  normalizeScoreInput,
}) {
  const [q, setQ] = useState("");
  const [selectedCells, setSelectedCells] = useState([]); // [{rowIdx, col: 'score'|'comment'}]

  const scoreRefs = useRef([]);
  const commentRefs = useRef([]);

  useEffect(() => {
    scoreRefs.current = new Array(rows.length);
    commentRefs.current = new Array(rows.length);
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
    if (idx < 0 || idx >= filtered.length) return;
    const el = scoreRefs.current[idx];
    if (el) {
      el.focus();
      el.select();
    }
  }, [filtered.length]);

  const focusPrev = useCallback((idx) => focusScore(Math.max(0, idx - 1)), [focusScore]);
  const focusNext = useCallback((idx) => focusScore(Math.min(filtered.length - 1, idx + 1)), [focusScore]);

  const focusComment = useCallback((idx) => {
    if (idx < 0 || idx >= filtered.length) return;
    const el = commentRefs.current[idx];
    if (el) el.focus();
  }, [filtered.length]);

  // Bulk actions
  const bulkSetMissing = useCallback((missing) => {
    if (isLocked) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const r of filtered) {
        const sid = r.student.id;
        const cur = next[sid] || r.draft || {};
        next[sid] = {
          ...cur,
          isMissing: !!missing,
          score: missing ? "" : (isBlankScore(cur.score) ? "" : cur.score),
        };
      }
      return next;
    });
  }, [filtered, isLocked, setDraft]);

  const autoMissing = useCallback(() => {
    if (isLocked) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const r of filtered) {
        const sid = r.student.id;
        const cur = next[sid] || r.draft || {};
        next[sid] = { ...cur, isMissing: isBlankScore(cur.score) };
      }
      return next;
    });
  }, [filtered, isLocked, setDraft]);

  // Paste handler (Excel-like)
  const handlePaste = useCallback((e, rowIdx) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text) return;

    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;

    setDraft((prev) => {
      const next = { ...prev };
      let currentIdx = rowIdx;

      lines.forEach((line) => {
        if (currentIdx >= filtered.length) return;
        const row = filtered[currentIdx];
        const sid = row.student.id;
        const cur = next[sid] || row.draft || {};

        const values = line.split(/\t|,/).map(v => v.trim());
        if (values.length >= 1) {
          const scoreVal = values[0];
          const n = normalizeScoreInput(scoreVal);
          next[sid] = {
            ...cur,
            score: scoreVal,
            isMissing: isBlankScore(scoreVal),
          };
        }
        if (values.length >= 2) {
          next[sid].comment = values[1];
        }

        currentIdx++;
      });

      return next;
    });

    // Move focus down after paste
    focusNext(rowIdx);
  }, [filtered, normalizeScoreInput, setDraft, focusNext]);

  const onScoreChange = useCallback((row, value) => {
    if (isLocked) return;

    const n = normalizeScoreInput(value);
    setDraft((prev) => {
      const sid = row.student.id;
      const cur = prev[sid] || row.draft || {};

      if (!n.ok) {
        return {
          ...prev,
          [sid]: { ...cur, score: value, isMissing: false },
        };
      }

      const blank = isBlankScore(value);
      return {
        ...prev,
        [sid]: {
          ...cur,
          score: value,
          isMissing: blank,
        },
      };
    });
  }, [isLocked, normalizeScoreInput, setDraft]);

  const toggleMissing = useCallback((row) => {
    if (isLocked) return;
    setDraft((prev) => {
      const sid = row.student.id;
      const cur = prev[sid] || row.draft || {};
      const nextMissing = !cur.isMissing;
      return {
        ...prev,
        [sid]: {
          ...cur,
          isMissing: nextMissing,
          score: nextMissing ? "" : cur.score,
        },
      };
    });
  }, [isLocked, setDraft]);

  const onCommentChange = useCallback((row, value) => {
    if (isLocked) return;
    setDraft((prev) => ({
      ...prev,
      [row.student.id]: {
        ...(prev[row.student.id] || row.draft),
        comment: value,
      },
    }));
  }, [isLocked, setDraft]);

  const onScoreKeyDown = useCallback((e, idx) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusNext(idx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusPrev(idx);
    } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      focusComment(idx);
    }
  }, [focusNext, focusPrev, focusComment]);

  const onCommentKeyDown = useCallback((e, idx) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      focusScore(idx + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusScore(idx);
    }
  }, [focusScore]);

  const progress = useMemo(() => {
    if (!rows.length) return 0;
    const entered = rows.filter(r => !isBlankScore(r.draft?.score)).length;
    return Math.round((entered / rows.length) * 100);
  }, [rows]);

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="font-medium text-lg">Marks Entry</div>
            <div className="text-sm text-muted-foreground mt-1">
              {filtered.length} of {rows.length} students shown
              {progress > 0 && ` • ${progress}% entered`}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search admission # or name…"
              className="h-10 w-full sm:w-72"
              disabled={loading || isLocked}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkSetMissing(false)}
                disabled={loading || isLocked || !filtered.length}
              >
                All Present
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkSetMissing(true)}
                disabled={loading || isLocked || !filtered.length}
              >
                All Missing
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={autoMissing}
                disabled={loading || isLocked || !filtered.length}
              >
                Auto-missing
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            Loading marks...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No active students in this class/marksheet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No matches for “{q}”.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[65vh]">
              <table className="w-full text-sm table-fixed">
                <thead className="sticky top-0 bg-background border-b z-10">
                  <tr className="text-left">
                    <th className="w-24 px-4 py-3 font-medium">Adm No</th>
                    <th className="w-64 px-4 py-3 font-medium">Student</th>
                    <th className="w-32 px-4 py-3 font-medium">Score (/100)</th>
                    <th className="w-28 px-4 py-3 font-medium text-center">Missing</th>
                    <th className="px-4 py-3 font-medium">Comment</th>
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
                        className={`border-b last:border-b-0 hover:bg-muted/50 focus-within:bg-muted/30 transition-colors ${
                          missing ? "bg-red-50/30" : ""
                        }`}
                        onKeyDown={(e) => {
                          if (e.key.toLowerCase() === "m") {
                            e.preventDefault();
                            toggleMissing(r);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            focusScore(idx);
                          }
                        }}
                        tabIndex={-1}
                      >
                        <td className="px-4 py-3 font-medium">{s.admissionNo || "—"}</td>

                        <td className="px-4 py-3">
                          <div className="font-medium">{fullName(s)}</div>
                          <div className="text-xs text-muted-foreground">{s.gender || "—"}</div>
                        </td>

                        <td className="px-4 py-3">
                          <Input
                            ref={(el) => (scoreRefs.current[idx] = el)}
                            value={scoreVal}
                            onChange={(e) => onScoreChange(r, e.target.value)}
                            onKeyDown={(e) => onScoreKeyDown(e, idx)}
                            onPaste={(e) => handlePaste(e, idx)}
                            disabled={isLocked}
                            placeholder={missing ? "Missing" : "0–100"}
                            className={`h-9 text-center ${missing ? "opacity-70 bg-muted/30" : ""} ${
                              scoreInvalid ? "border-red-500 focus-visible:ring-red-500" : ""
                            }`}
                            inputMode="numeric"
                            aria-invalid={scoreInvalid}
                          />
                          {scoreInvalid && (
                            <div className="text-xs text-red-600 mt-1 text-center">
                              {normalized.message || "Invalid"}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => toggleMissing(r)}
                            className={`w-20 h-9 rounded border text-sm font-medium transition-colors ${
                              missing
                                ? "bg-red-100 border-red-300 hover:bg-red-200 text-red-800"
                                : "bg-background hover:bg-muted border-border text-muted-foreground"
                            } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
                            title="Toggle missing (shortcut: M)"
                          >
                            {missing ? "Yes" : "No"}
                          </button>
                        </td>

                        <td className="px-4 py-3">
                          <Input
                            ref={(el) => (commentRefs.current[idx] = el)}
                            value={d.comment ?? ""}
                            onChange={(e) => onCommentChange(r, e.target.value)}
                            onKeyDown={(e) => onCommentKeyDown(e, idx)}
                            disabled={isLocked}
                            placeholder="Optional comment…"
                            className="h-9"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isLocked && (
          <div className="text-sm text-amber-700 bg-amber-50/70 p-3 rounded border border-amber-200 mt-4">
            This marksheet is <strong>SUBMITTED</strong>. Editing is locked.
          </div>
        )}
      </CardContent>
    </Card>
  );
}