import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/** "Students › Achieng Otieno": where this page sits; every step but the last is a link. */
export default function Breadcrumbs({ items = [], className = "" }) {
  return (
    <nav aria-label="Breadcrumb" className={`mb-1 text-sm text-muted-foreground ${className}`}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {it.to && !last ? (
                <Link to={it.to} className="truncate hover:text-foreground hover:underline">
                  {it.label}
                </Link>
              ) : (
                <span className={`truncate ${last ? "text-foreground" : ""}`} aria-current={last ? "page" : undefined}>
                  {it.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
