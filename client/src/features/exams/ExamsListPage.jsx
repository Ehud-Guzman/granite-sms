// src/features/exams/ExamsListPage.jsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listExamSessions } from "@/api/exams.api";
import { listClasses } from "@/api/classes.api";
import { useMe } from "@/hooks/useMe";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import ExamCreateDrawer from "./ExamCreateDrawer";

const TERMS = ["ALL", "TERM1", "TERM2", "TERM3"];


function currentYear() {
  return new Date().getFullYear();
}

function statusBadgeVariant(status) {
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

function safeYearNumber(yearStr) {
  const n = Number(yearStr);
  if (!Number.isFinite(n)) return undefined;
  if (!Number.isInteger(n)) return undefined;
  return n;
}

function errMsg(err) {
  return (
    err?.response?.data?.message ||
    err?.message ||
    "Request failed"
  );
}

export default function ExamsListPage() {
  const qc = useQueryClient();
  const { data: meData } = useMe();
  const role = meData?.user?.role;

  const [year, setYear] = useState(String(currentYear()));
  const [term, setTerm] = useState("ALL");

  const [search, setSearch] = useState("");

  const yearNum = useMemo(() => safeYearNumber(year), [year]);

  // build filters carefully so backend doesn't get junk
const filters = useMemo(() => {
  const f = {};
  if (yearNum) f.year = yearNum;
  if (term && term !== "ALL") f.term = term;
  return f;
}, [yearNum, term]);


  // Sessions query (API returns an array)
  const sessionsQ = useQuery({
    queryKey: ["examSessions", filters],
    queryFn: () => listExamSessions(filters),
    enabled: Boolean(yearNum && term),
  });

  const sessions = sessionsQ.data ?? [];

  // Classes for the year (to map classId -> label)
  const classesQ = useQuery({
    enabled: Boolean(yearNum),
    queryKey: ["classes", { year: yearNum }],
    queryFn: () => listClasses({ year: yearNum }),
  });

  const classes = classesQ.data ?? [];

  const classLabelById = useMemo(() => {
    const map = new Map();
    for (const c of classes) map.set(String(c.id), fmtClass(c));
    return map;
  }, [classes]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return sessions;

    return sessions.filter((x) => {
      const name = String(x.name || "").toLowerCase();
      const type = String(x.examType?.name || "").toLowerCase();
      const code = String(x.examType?.code || "").toLowerCase();
      const classLabel = String(classLabelById.get(String(x.classId)) || "").toLowerCase();

      return (
        name.includes(s) ||
        type.includes(s) ||
        code.includes(s) ||
        classLabel.includes(s)
      );
    });
  }, [sessions, search, classLabelById]);

const activeFiltersText = useMemo(() => {
  const y = yearNum ? String(yearNum) : "—";
  const t = term === "ALL" ? "All terms" : (term || "—");
  return `Year ${y} • ${t}`;
}, [yearNum, term]);


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Exams</CardTitle>
          <div className="text-sm opacity-70">
            Sessions by year + term. Open a session to manage marksheets and enter marks.
          </div>
          <div className="text-xs opacity-70">{activeFiltersText}</div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Filters row */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Year</span>
              <Input
                className="w-28"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">Term</span>
            <select
  className="h-10 rounded-md border bg-background px-3 text-sm"
  value={term}
  onChange={(e) => setTerm(e.target.value)}
>
  {TERMS.map((t) => (
    <option key={t} value={t}>
      {t === "ALL" ? "All terms" : t}
    </option>
  ))}
</select>

            </div>

            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name / exam type / class…"
              />
            </div>

            {role === "ADMIN" && (
              <ExamCreateDrawer
                defaultYear={yearNum || currentYear()}
                defaultTerm={term}
                onCreated={() => {
                  // invalidate all variants of examSessions query keys
                  qc.invalidateQueries({ queryKey: ["examSessions"], exact: false });
                }}
              />
            )}
          </div>

          <Separator />

          {/* Loading / errors */}
          {!yearNum && (
            <div className="text-sm text-red-600">
              Year must be a valid number (e.g. 2026).
            </div>
          )}

          {sessionsQ.isLoading && <div className="opacity-70">Loading sessions…</div>}
          {sessionsQ.isError && (
            <div className="text-red-600">
              Failed to load sessions: {errMsg(sessionsQ.error)}
            </div>
          )}

          {classesQ.isLoading && yearNum && (
            <div className="text-sm opacity-70">Loading classes…</div>
          )}
          {classesQ.isError && (
            <div className="text-sm text-red-600">
              Failed to load classes (for class labels): {errMsg(classesQ.error)}
            </div>
          )}

          {/* Empty state */}
          {!sessionsQ.isLoading && !sessionsQ.isError && filtered.length === 0 && (
            <div className="opacity-70">
              No exam sessions found for filters.
              <div className="text-xs opacity-70 mt-1">
                Tip: you are currently filtering by <span className="font-medium">{activeFiltersText}</span>.
              </div>
            </div>
          )}

          {/* Sessions list */}
          <div className="grid gap-3">
            {filtered.map((s) => {
              const clsLabel = classLabelById.get(String(s.classId)) || String(s.classId);

              return (
                <Card key={s.id}>
                  <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{s.name || "Untitled Session"}</div>

                      <div className="text-sm opacity-70 flex flex-wrap gap-2 items-center">
                        <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
                        <span>Year: {s.year}</span>
                        <span>Term: {s.term}</span>
                        <span>Class: {clsLabel}</span>

                        {s.examType?.name && (
                          <span>
                            Type: {s.examType.name}
                            {s.examType?.code ? ` (${s.examType.code})` : ""}
                          </span>
                        )}
                        {typeof s.examType?.weight === "number" && (
                          <span>Weight: {s.examType.weight}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button asChild variant="secondary">
                        <Link to={`/app/exams/sessions/${s.id}/marksheets`}>Open</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
