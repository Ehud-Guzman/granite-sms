import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Showing 26–50 of 210" with Previous/Next and a few page numbers.
 * Pass the server's total and the page size; it works out the rest.
 */
export default function Pager({ page, pageSize, total, busy, onGo, noun = "", className = "" }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums = [];
  for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 text-sm ${className}`}>
      <div className="text-muted-foreground">
        Showing <b className="text-foreground">{from.toLocaleString()}–{to.toLocaleString()}</b> of{" "}
        <b className="text-foreground">{total.toLocaleString()}</b>
        {noun ? ` ${noun}` : ""}
        {busy && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onGo(page - 1)}>
            Previous
          </Button>
          {nums[0] > 1 && <span className="hidden px-1 text-muted-foreground sm:inline">…</span>}
          {nums.map((n) => (
            <Button
              key={n}
              variant={n === page ? "default" : "ghost"}
              size="sm"
              className={`w-9 px-0 ${n === page ? "" : "hidden sm:inline-flex"}`}
              onClick={() => onGo(n)}
              aria-current={n === page ? "page" : undefined}
            >
              {n}
            </Button>
          ))}
          {nums[nums.length - 1] < pages && <span className="hidden px-1 text-muted-foreground sm:inline">…</span>}
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onGo(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
