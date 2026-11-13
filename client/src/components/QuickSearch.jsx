// Find anything from the top bar: a learner by name or admission number, a
// class, or a page. Ctrl+K (or /) opens it from anywhere; arrows and Enter
// pick a result. Staff only: learners and parents have little to search.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, School, Search, User, Wallet } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listStudentsPage } from "@/features/students/students.api";
import { listClasses } from "@/api/classes.api";

const classLabel = (c) => (c ? `${c.name}${c.stream ? ` ${c.stream}` : ""}` : "");
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

export default function QuickSearch({ role, navItems = [] }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  const canProfiles = role === "ADMIN" || role === "TEACHER";
  const canFees = role === "ADMIN" || role === "BURSAR";

  // Ctrl+K / Cmd+K anywhere; "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  const learnersQ = useQuery({
    queryKey: ["quickSearch", "learners", query],
    queryFn: () => listStudentsPage({ q: query, page: 1, pageSize: 6 }),
    enabled: open && query.length >= 2,
    staleTime: 30 * 1000,
  });
  const classesQ = useQuery({
    queryKey: ["classes", { quick: true }],
    queryFn: () => listClasses({}),
    enabled: open && canProfiles,
    staleTime: 5 * 60 * 1000,
  });

  // One flat list of results, in sections, so the arrow keys walk through all of them.
  const results = useMemo(() => {
    const q = query.toLowerCase();
    const out = [];
    if (q.length >= 2) {
      for (const s of learnersQ.data?.items || []) {
        const name = `${s.firstName} ${s.lastName}`.trim();
        const meta = [s.admissionNo, classLabel(s.class)].filter(Boolean).join(" · ");
        const fees = `/app/fees?tab=student&student=${s.id}`;
        // Staff who teach open the profile (admins also get a Fees shortcut);
        // the bursar goes straight to the fees statement.
        if (canProfiles) out.push({ key: `s-${s.id}`, section: "Learners", icon: User, label: name, meta, to: `/app/students/${s.id}`, alt: canFees ? { label: "Fees", to: fees } : null });
        else if (canFees) out.push({ key: `f-${s.id}`, section: "Learners", icon: Wallet, label: name, meta, to: fees });
      }
    }
    if (q) {
      const classes = Array.isArray(classesQ.data) ? classesQ.data : [];
      for (const c of classes.filter((c) => c.isActive !== false && `${classLabel(c)} ${c.year}`.toLowerCase().includes(q)).slice(0, 5)) {
        out.push({ key: `c-${c.id}`, section: "Classes", icon: School, label: classLabel(c), meta: String(c.year), to: `/app/classes/${c.id}` });
      }
    }
    for (const n of navItems.filter((n) => !q || n.label.toLowerCase().includes(q)).slice(0, q ? 5 : 8)) {
      out.push({ key: `p-${n.to}`, section: "Go to", icon: ArrowRight, label: n.label, meta: n.group || "", to: n.to });
    }
    return out;
  }, [query, learnersQ.data, classesQ.data, navItems, canProfiles, canFees]);

  const choose = (r) => {
    if (!r) return;
    setOpen(false);
    setText("");
    nav(r.to);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[Math.min(active, results.length - 1)]);
    }
  };

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const searching = query.length >= 2 && learnersQ.isFetching;
  let lastSection = null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground transition hover:bg-muted sm:w-64"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        <span className="hidden flex-1 truncate whitespace-nowrap text-left sm:inline">Search learners, classes…</span>
        <kbd className="hidden rounded border bg-background px-1.5 text-[10px] font-medium sm:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setText("");
        }}
      >
        <DialogContent className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3 pr-10">
            {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
            <input
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={canProfiles || canFees ? "Name, admission number, class or page…" : "Page…"}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search"
            />
          </div>
          <ul ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {query.length >= 2 && learnersQ.isFetching ? "Searching…" : "Nothing found."}
              </li>
            )}
            {results.map((r, i) => {
              const heading = r.section !== lastSection ? r.section : null;
              lastSection = r.section;
              const Icon = r.icon;
              return (
                <li key={r.key}>
                  {heading && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
                  <div
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    className={`flex items-center gap-1 rounded-md pr-1.5 ${i === active ? "bg-primary/10 text-foreground" : ""}`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onClick={() => choose(r)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left text-sm"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                      {r.meta && <span className="shrink-0 truncate text-xs text-muted-foreground">{r.meta}</span>}
                    </button>
                    {r.alt && (
                      <button
                        type="button"
                        onClick={() => choose(r.alt)}
                        className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
                        title={`${r.label}: fees statement`}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        {r.alt.label}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden border-t px-3 py-1.5 text-[11px] text-muted-foreground sm:block">↑ ↓ to move · Enter to open · Esc to close</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
