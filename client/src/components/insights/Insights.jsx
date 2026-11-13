// Building blocks for dashboards and reports, after the Chama system's: one
// figure that matters in a dark hero card, a ring for "how far along", and
// bars a person can read at a glance. Plain SVG and CSS, no chart library.
import { Link, NavLink } from "react-router-dom";

const TONE_BG = {
  primary: "bg-primary",
  good: "bg-emerald-600",
  warn: "bg-amber-500",
  alert: "bg-red-600",
  muted: "bg-slate-400",
  sky: "bg-sky-600",
  violet: "bg-violet-500",
};
const TONE_TEXT = {
  primary: "text-primary",
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  alert: "text-red-700 dark:text-red-400",
  muted: "text-muted-foreground",
};
const TONE_STROKE = {
  primary: "hsl(var(--primary))",
  good: "#059669",
  warn: "#f59e0b",
  alert: "#dc2626",
  muted: "#94a3b8",
  sky: "#0284c7",
  violet: "#8b5cf6",
};

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));

/** Page or report heading: a small eyebrow, the title, a line under it and actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions, className = "" }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A white card with a heading row. */
export function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`rounded-2xl border bg-card p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The dark card a page opens with: the figure that matters, big, with a few
 * supporting figures under a rule. `aside` sits on the right (often a Ring).
 */
export function HeroPanel({ eyebrow, value, caption, minis = [], aside, children }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-[hsl(var(--primary))] p-5 text-white shadow-lg sm:p-6 print:bg-none print:text-black print:shadow-none print:border">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 print:hidden" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl print:hidden" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-white/70 print:text-black/70">{eyebrow}</div>}
          <div className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">{value}</div>
          {caption && <div className="mt-1 text-sm text-white/80 print:text-black/70">{caption}</div>}
          {minis.length > 0 && (
            <div className={`mt-5 grid gap-4 border-t border-white/15 pt-4 print:border-black/20 grid-cols-2 ${minis.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              {minis.map((m) => (
                <div key={m.label} className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-white/70 print:text-black/70">{m.label}</div>
                  <div className={`mt-0.5 text-lg font-bold tabular-nums ${m.alert ? "text-red-300 print:text-red-700" : ""}`}>{m.value}</div>
                </div>
              ))}
            </div>
          )}
          {children}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </section>
  );
}

/** A ring that fills to `percent`; the middle shows whatever is passed as children. */
export function Ring({ percent = 0, size = 120, stroke = 12, tone = "primary", track = "rgba(148,163,184,0.25)", children, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label || `${Math.round(clamp(percent))}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        {/* On paper the white-on-dark ring would vanish, so it prints dark on light. */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} className="print:[stroke:#e5e7eb]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_STROKE[tone] || tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="print:[stroke:#111827]"
          strokeDasharray={c}
          strokeDashoffset={c - (clamp(percent) / 100) * c}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** A small figure card. */
export function StatTile({ label, value, hint, tone, to }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ? TONE_TEXT[tone] : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = "block rounded-2xl border bg-card p-4 shadow-sm";
  return to ? (
    <Link to={to} className={`${cls} transition hover:border-primary/40 hover:shadow`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A thin progress bar. */
export function Meter({ percent = 0, tone = "primary", className = "" }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-muted ${className}`} aria-hidden="true">
      <div className={`h-full rounded-full ${TONE_BG[tone] || TONE_BG.primary}`} style={{ width: `${clamp(percent)}%`, transition: "width 0.6s ease-out" }} />
    </div>
  );
}

/**
 * Labelled horizontal bars, longest first as given: who owes most, which
 * subject is strongest. items: [{ key, label, value, display?, sub?, tone?, to? }]
 */
export function BarList({ items = [], max, tone = "primary", empty = "Nothing to show.", valueClassName = "" }) {
  if (!items.length) return <EmptyNote>{empty}</EmptyNote>;
  const top = max ?? Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const pct = top ? ((Number(i.value) || 0) / top) * 100 : 0;
        const label = i.to ? (
          <Link to={i.to} className="truncate font-medium hover:underline">
            {i.label}
          </Link>
        ) : (
          <span className="truncate font-medium">{i.label}</span>
        );
        return (
          <li key={i.key ?? i.label} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex items-baseline gap-2">
                {label}
                {i.sub && <span className="truncate text-xs text-muted-foreground">{i.sub}</span>}
              </div>
              <span className={`shrink-0 font-semibold tabular-nums ${valueClassName}`}>{i.display ?? i.value}</span>
            </div>
            <Meter percent={pct} tone={i.tone || tone} className="mt-1.5" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Columns over time, as SVG that scales to its card. points: [{ label, value, display? }].
 * Labels thin out on long series so they never overlap on a phone.
 */
export function ColumnChart({ points = [], height = 180, tone = "primary", empty = "Nothing in this period yet.", ariaLabel = "Chart", highlightLast = false }) {
  const WIDTH = 560;
  const TOP = 14;
  const BOTTOM = 26;
  const PAD = 8;
  if (!points.some((p) => Number(p.value) > 0)) return <EmptyNote>{empty}</EmptyNote>;
  const plot = height - TOP - BOTTOM;
  const max = Math.max(1, ...points.map((p) => Number(p.value) || 0));
  const slot = (WIDTH - PAD * 2) / points.length;
  const bar = Math.max(4, Math.min(28, slot * 0.64));
  const every = points.length > 16 ? Math.ceil(points.length / 8) : points.length > 8 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[0.5, 1].map((f) => (
        <line key={f} x1={PAD} x2={WIDTH - PAD} y1={TOP + plot * (1 - f)} y2={TOP + plot * (1 - f)} stroke="currentColor" className="text-border" strokeDasharray="3 4" />
      ))}
      <line x1={PAD} x2={WIDTH - PAD} y1={height - BOTTOM} y2={height - BOTTOM} stroke="currentColor" className="text-border" />
      {points.map((p, i) => {
        const v = Number(p.value) || 0;
        const h = (v / max) * plot;
        const x = PAD + slot * i + (slot - bar) / 2;
        const last = highlightLast && i === points.length - 1;
        return (
          <g key={p.key ?? p.label ?? i}>
            <rect x={x} y={height - BOTTOM - h} width={bar} height={Math.max(h, v > 0 ? 2 : 0)} rx="3" fill={TONE_STROKE[tone] || tone} opacity={last || !highlightLast ? 1 : 0.55}>
              <title>{`${p.label}: ${p.display ?? v}`}</title>
            </rect>
            {(i % every === 0 || i === points.length - 1) && (
              <text x={x + bar / 2} y={height - BOTTOM + 15} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** One bar split into parts (e.g. paid / part-paid / unpaid), with a legend. */
export function SegmentBar({ segments = [], empty = "Nothing to show." }) {
  const total = segments.reduce((n, s) => n + (Number(s.value) || 0), 0);
  if (!total) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {segments.map((s) =>
          Number(s.value) > 0 ? <div key={s.label} className={TONE_BG[s.tone] || s.tone} style={{ width: `${(s.value / total) * 100}%` }} /> : null
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-sm ${TONE_BG[s.tone] || s.tone}`} aria-hidden="true" />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.display ?? s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dashed box for "nothing here". */
export function EmptyNote({ children }) {
  return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Segmented tabs (route links), like the Chama report switcher. tabs: [{ to, label }] */
export function TabLinks({ tabs }) {
  return (
    <nav className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-1 no-print" aria-label="Sections">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
