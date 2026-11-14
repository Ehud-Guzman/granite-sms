// A week's timetable. Laptop: days down the side, periods across, breaks as
// narrow shaded columns, today's row and the period happening now marked.
// Phone: one day at a time (today first), periods as a list.
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { DAY_NAMES, DAY_SHORT, minutes } from "./timetable.api";
import { lessonStyle, subjectColourMap } from "./subjectColours";

const isDarkMode = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/**
 * days, periods, lessons: from the API.
 * lines(lesson) -> [main, sub]: what each cell says (subject + teacher, or class + subject).
 * onSlot(day, period, lesson|null): makes cells clickable (editing); omit for read-only.
 * highlight: Set of "day|periodId" to mark (auto-fill preview).
 * today: { day, now: "HH:MM" } to mark today's row and the period now.
 * subjects: every subject in the school [{ id, name }], for stable colours.
 */
export default function WeekGrid({ days = [], periods = [], lessons = [], subjects, lines, onSlot, highlight, today, emptyText = "Free" }) {
  const byKey = useMemo(() => new Map(lessons.map((l) => [`${l.day}|${l.periodId}`, l])), [lessons]);
  // Colours come from the school's whole subject list, so Maths is the same colour in every class.
  const colours = useMemo(() => subjectColourMap(subjects?.length ? subjects : lessons.map((l) => l.subject).filter(Boolean)), [subjects, lessons]);
  const dark = isDarkMode();
  const nowMin = today?.now ? minutes(today.now) : null;
  const isNow = (day, p) => today && day === today.day && nowMin != null && nowMin >= minutes(p.startsAt) && nowMin < minutes(p.endsAt);
  const [phoneDay, setPhoneDay] = useState(() => (today && days.includes(today.day) ? today.day : days[0]));
  const shownDay = days.includes(phoneDay) ? phoneDay : days[0];

  if (!periods.length) {
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">The school day hasn&apos;t been set up yet.</p>;
  }

  const renderCell = (day, p, compact = false) => {
    const l = byKey.get(`${day}|${p.id}`);
    const marked = highlight?.has(`${day}|${p.id}`);
    const [main, sub] = l ? lines(l) : [];
    const body = l ? (
      <div className={`h-full rounded-md px-2 py-1.5 text-left ${marked ? "ring-2 ring-primary" : ""}`} style={lessonStyle(colours.get(l.subjectId), dark)}>
        <div className={`font-medium leading-tight ${compact ? "text-sm" : "text-[13px]"} line-clamp-2 break-words hyphens-auto`} lang="en">{main}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    ) : marked ? (
      <div className="flex h-full items-center justify-center rounded-md border-2 border-dashed border-primary text-xs text-primary">new</div>
    ) : (
      <div className="flex h-full items-center justify-center rounded-md text-xs text-muted-foreground/60">
        {onSlot ? <Plus className="h-4 w-4 opacity-0 transition group-hover:opacity-100" aria-hidden="true" /> : null}
        {!onSlot && <span className="sr-only">{emptyText}</span>}
      </div>
    );
    if (!onSlot) return body;
    return (
      <button
        type="button"
        onClick={() => onSlot(day, p, l || null)}
        className="group h-full w-full rounded-md outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`${DAY_NAMES[day]}, ${p.label} (${p.startsAt}-${p.endsAt}): ${l ? main : "empty"}. ${l ? "Change" : "Add a lesson"}`}
      >
        {body}
      </button>
    );
  };

  return (
    <>
      {/* Laptop and tablet: the whole week */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: "6.5rem" }} />
            {periods.map((p) => (
              <col key={p.id} style={p.kind === "BREAK" ? { width: "2.25rem" } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-muted/50">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Day</th>
              {periods.map((p) =>
                p.kind === "BREAK" ? (
                  <th key={p.id} className="bg-muted px-0 py-2" title={`${p.label} ${p.startsAt}-${p.endsAt}`}>
                    <span className="sr-only">{p.label}</span>
                  </th>
                ) : (
                  <th key={p.id} className="px-1 py-2 text-center">
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-[10px] font-normal tabular-nums text-muted-foreground">
                      {p.startsAt}-{p.endsAt}
                    </div>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {days.map((day, rowIdx) => (
              <tr key={day} className={`border-t ${today?.day === day ? "bg-primary/5" : ""}`}>
                <th scope="row" className="px-3 py-1 text-left align-middle">
                  <div className="text-sm font-semibold">{DAY_NAMES[day]}</div>
                  {today?.day === day && <div className="text-[10px] font-medium uppercase tracking-wide text-primary">Today</div>}
                </th>
                {periods.map((p) =>
                  p.kind === "BREAK" ? (
                    rowIdx === 0 ? (
                      <td key={p.id} rowSpan={days.length} className="bg-muted/70 p-0 align-middle">
                        <div className="mx-auto whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                          {p.label} · {p.startsAt}
                        </div>
                      </td>
                    ) : null
                  ) : (
                    <td key={p.id} className={`h-16 p-1 align-top ${isNow(day, p) ? "bg-primary/10" : ""}`}>
                      {renderCell(day, p)}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one day at a time */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Day">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === shownDay}
              onClick={() => setPhoneDay(d)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${d === shownDay ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {DAY_SHORT[d]}
              {today?.day === d ? " ·" : ""}
            </button>
          ))}
        </div>
        <ul className="space-y-1.5">
          {periods.map((p) =>
            p.kind === "BREAK" ? (
              <li key={p.id} className="rounded-md bg-muted/60 px-3 py-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {p.label} · {p.startsAt}-{p.endsAt}
              </li>
            ) : (
              <li key={p.id} className={`grid grid-cols-[4.5rem_1fr] items-stretch gap-2 rounded-lg ${isNow(shownDay, p) ? "bg-primary/10" : ""}`}>
                <div className="py-1.5 pl-1 text-xs">
                  <div className="font-semibold">{p.label}</div>
                  <div className="tabular-nums text-muted-foreground">{p.startsAt}</div>
                </div>
                <div className="min-h-[3rem]">
                  {renderCell(shownDay, p, true)}
                </div>
              </li>
            )
          )}
        </ul>
      </div>
    </>
  );
}
