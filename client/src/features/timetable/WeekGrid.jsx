// A week's timetable. Laptop: days down the side, periods across, breaks as
// narrow shaded columns, today's row and the period happening now marked;
// periods that don't run on a day are greyed. A slot can hold parallel group
// lessons (options), shown stacked. Admins can drag a lesson to another slot
// (moves it, or swaps with what's there). Phone: one day at a time.
import { useMemo, useState } from "react";
import { Link2, Plus } from "lucide-react";

import { DAY_NAMES, DAY_SHORT, minutes } from "./timetable.api";
import { lessonStyle, subjectColourMap } from "./subjectColours";

const isDarkMode = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
const runsOn = (p, day) => !p.days?.length || p.days.includes(day);

/**
 * days, periods, lessons, subjects: from the API (subjects keep colours stable).
 * lines(lesson) -> [main, sub].
 * onSlot(day, period, lessons[]): clicking a slot (editing). Omit for read-only.
 * onMove(lesson, day, period): dropping a dragged lesson on a slot.
 * highlight: Set of "day|periodId" (auto-fill preview). today: { day, now }.
 */
export default function WeekGrid({ days = [], periods = [], lessons = [], subjects, lines, onSlot, onMove, highlight, today }) {
  const byKey = useMemo(() => {
    const m = new Map();
    for (const l of lessons) m.set(`${l.day}|${l.periodId}`, [...(m.get(`${l.day}|${l.periodId}`) || []), l]);
    return m;
  }, [lessons]);
  const colours = useMemo(() => subjectColourMap(subjects?.length ? subjects : lessons.map((l) => l.subject).filter(Boolean)), [subjects, lessons]);
  const dark = isDarkMode();
  const nowMin = today?.now ? minutes(today.now) : null;
  const isNow = (day, p) => today && day === today.day && nowMin != null && nowMin >= minutes(p.startsAt) && nowMin < minutes(p.endsAt);
  const [phoneDay, setPhoneDay] = useState(() => (today && days.includes(today.day) ? today.day : days[0]));
  const shownDay = days.includes(phoneDay) ? phoneDay : days[0];
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);

  if (!periods.length) {
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">The school day hasn&apos;t been set up yet.</p>;
  }

  const renderCell = (day, p, compact = false) => {
    if (!runsOn(p, day)) return <div className="h-full rounded-md bg-muted/50" title={`${p.label} doesn't run on ${DAY_NAMES[day]}`} />;
    const key = `${day}|${p.id}`;
    const ls = byKey.get(key) || [];
    const marked = highlight?.has(key);
    const body = ls.length ? (
      <div className={`grid h-full min-w-0 gap-0.5 ${marked ? "rounded-md ring-2 ring-primary" : ""}`}>
        {ls.map((l) => {
          const [main, sub] = lines(l);
          return (
            <div
              key={l.id}
              draggable={!!onMove && !l.linkId}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", l.id);
                setDragging(l);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={`min-w-0 overflow-hidden rounded-md px-2 py-1 text-left ${onMove && !l.linkId ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={lessonStyle(colours.get(l.subjectId), dark)}
            >
              <div className={`flex items-center gap-1 font-medium leading-tight ${compact ? "text-sm" : "text-[13px]"}`}>
                <span className="line-clamp-2 break-words hyphens-auto" lang="en">
                  {main}
                  {l.group ? <span className="font-normal text-muted-foreground"> ({l.group})</span> : null}
                </span>
                {l.linkId && <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Combined with other classes" />}
              </div>
              {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
            </div>
          );
        })}
      </div>
    ) : marked ? (
      <div className="flex h-full items-center justify-center rounded-md border-2 border-dashed border-primary text-xs text-primary">new</div>
    ) : (
      <div className="flex h-full items-center justify-center rounded-md">{onSlot ? <Plus className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" aria-hidden="true" /> : null}</div>
    );
    if (!onSlot) return body;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSlot(day, p, ls)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSlot(day, p, ls))}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          setOver(key);
        }}
        onDragLeave={() => setOver((o) => (o === key ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging && onMove) onMove(dragging, day, p);
          setDragging(null);
          setOver(null);
        }}
        className={`group h-full w-full cursor-pointer rounded-md outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary ${over === key ? "bg-primary/15 ring-2 ring-primary" : ""}`}
        aria-label={`${DAY_NAMES[day]}, ${p.label} (${p.startsAt}-${p.endsAt}): ${ls.length ? ls.map((l) => lines(l)[0]).join(", ") : "empty"}. ${ls.length ? "Change" : "Add a lesson"}`}
      >
        {body}
      </div>
    );
  };

  return (
    <>
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
            {days.map((day) => (
              <tr key={day} className={`border-t ${today?.day === day ? "bg-primary/5" : ""}`}>
                <th scope="row" className="px-3 py-1 text-left align-middle">
                  <div className="text-sm font-semibold">{DAY_NAMES[day]}</div>
                  {today?.day === day && <div className="text-[10px] font-medium uppercase tracking-wide text-primary">Today</div>}
                </th>
                {periods.map((p) =>
                  p.kind === "BREAK" ? (
                    <td key={p.id} className={`p-0 align-middle ${runsOn(p, day) ? "bg-muted/70" : ""}`}>
                      {runsOn(p, day) && (
                        <div className="mx-auto whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] rotate-180">{p.label}</div>
                      )}
                    </td>
                  ) : (
                    <td key={p.id} className={`h-16 overflow-hidden p-1 align-top ${isNow(day, p) ? "bg-primary/10" : ""}`}>
                      {renderCell(day, p)}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
          {periods
            .filter((p) => runsOn(p, shownDay))
            .map((p) =>
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
                  <div className="min-h-[3rem]">{renderCell(shownDay, p, true)}</div>
                </li>
              )
            )}
        </ul>
      </div>
    </>
  );
}
