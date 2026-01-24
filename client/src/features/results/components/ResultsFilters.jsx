import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const TERMS = ["TERM1", "TERM2", "TERM3"];

export default function ResultsFilters({
  year,
  setYear,
  term,
  setTerm,
  search,
  setSearch,
  showGrades,
  setShowGrades,
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Year</span>
          <Input className="w-28" value={year} onChange={(e) => setYear(e.target.value)} />
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
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by session / exam type / class…"
          />
        </div>

        <label className="flex items-center gap-2 text-sm opacity-70 select-none">
          <input
            type="checkbox"
            checked={showGrades}
            onChange={(e) => setShowGrades(e.target.checked)}
          />
          Show grades
        </label>
      </div>

      <Separator />
    </div>
  );
}
