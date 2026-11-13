// Exams grouped the way a school thinks about them: one card per exam in a
// term ("Mid-Term exam, Term 3"), with each class inside it. Replaces a flat
// list of every exam x class (64 cards a year for an 8-class school).
import { Badge } from "@/components/ui/badge";

const STATUS_STYLE = {
  PUBLISHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  DRAFT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUBMITTED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};
const STATUS_WORD = { PUBLISHED: "published", DRAFT: "draft", SUBMITTED: "submitted", LOCKED: "locked" };
const TERM_RANK = { TERM3: 3, TERM2: 2, TERM1: 1 };

/** [{ key, title, term, year, sessions: [...] }], newest term first, exams in the order they were set. */
function groupExams(sessions) {
  const sorted = [...sessions].sort(
    (a, b) =>
      (b.year || 0) - (a.year || 0) ||
      (TERM_RANK[b.term] || 0) - (TERM_RANK[a.term] || 0) ||
      String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
  );
  const groups = new Map();
  for (const s of sorted) {
    const title = s.name || s.examType?.name || "Exam";
    const key = `${s.year}|${s.term}|${title}`;
    if (!groups.has(key)) groups.set(key, { key, title, term: s.term, year: s.year, examType: s.examType, sessions: [] });
    groups.get(key).sessions.push(s);
  }
  return [...groups.values()];
}

export function StatusPill({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] || "bg-muted text-muted-foreground"}`}>
      {STATUS_WORD[status] || String(status || "").toLowerCase()}
    </span>
  );
}

/**
 * sessions: the exams to show; classLabelOf(session) -> "Grade 7 East";
 * renderAction(session) -> the button for that class (Open, View results…).
 */
export default function ExamGroups({ sessions, classLabelOf, termLabels, renderAction, emptyText = "No exams for these filters." }) {
  const groups = groupExams(sessions);
  if (!groups.length) return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const counts = {};
        for (const s of g.sessions) counts[s.status] = (counts[s.status] || 0) + 1;
        const rows = [...g.sessions].sort((a, b) => classLabelOf(a).localeCompare(classLabelOf(b), undefined, { numeric: true }));
        return (
          <section key={g.key} className="rounded-2xl border bg-card shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{g.title}</h3>
                <div className="text-xs text-muted-foreground">
                  {termLabels?.[g.term] || g.term} {g.year}
                  {g.examType?.weight ? ` · counts ×${g.examType.weight} in the term` : ""} · {g.sessions.length} class{g.sessions.length === 1 ? "" : "es"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(counts).map(([status, n]) => (
                  <Badge key={status} variant="outline" className="gap-1 font-normal">
                    <b>{n}</b> {STATUS_WORD[status] || status.toLowerCase()}
                  </Badge>
                ))}
              </div>
            </header>
            <ul className="-mt-px grid sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* The year is in the card header already. */}
                    <span className="truncate font-medium">{classLabelOf(s).replace(/\s*\(\d{4}\)$/, "")}</span>
                    <StatusPill status={s.status} />
                  </div>
                  {renderAction(s)}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
