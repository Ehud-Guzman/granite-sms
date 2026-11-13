// Small charts that open big on demand. A ChartCard shows a headline number
// and a compact chart; clicking it (or its expand button) opens the same
// chart full-size with axes, hover readouts and the numbers as a table.
// Plain SVG, one series per chart in the school's main colour.
import { useId, useRef, useState } from "react";
import { Maximize2, Table2, BarChart3 } from "lucide-react";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MAIN = "hsl(var(--primary))";
const W = 640; // SVG user units; everything scales to the card's width

/** Clean axis ticks: 0, step, 2·step… up to at least `max`. */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const compactNum = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString("en-KE");
};

/** Every nth label, plus the last one when it won't crowd its neighbour. */
const showLabel = (i, n, every) => i % every === 0 || (i === n - 1 && (n - 1) % every >= Math.ceil(every * 0.6));

/** The floating readout: value first (strong), label under it. */
function Readout({ x, y, value, label }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-center shadow-md"
      style={{ left: `${x}%`, top: `${y}%`, marginTop: -8 }}
      role="status"
    >
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Change over time. points: [{ key, label, value, display? }].
 * compact: no axes, just the shape and the last value. yMax pins the top
 * (e.g. 100 for percentages); yMin can lift the floor so small changes show
 * (a line, unlike a bar, needn't start at zero); target draws a reference line.
 */
export function TrendChart({ points = [], height = 220, compact = false, yMax, yMin = 0, target, format = compactNum, ariaLabel = "Trend" }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const gradId = useId().replace(/:/g, "");
  const H = height;
  const top = compact ? 8 : 16;
  const bottom = compact ? 6 : 28;
  const left = compact ? 4 : 44;
  const right = compact ? 76 : 16;
  const max = yMax ?? Math.max(yMin + 1, ...points.map((p) => Number(p.value) || 0));
  const ticks = niceTicks(max - yMin).map((t) => t + yMin);
  const top0 = ticks[ticks.length - 1];
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const xAt = (i) => left + (points.length <= 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const yAt = (v) => top + plotH - ((Math.max(yMin, v) - yMin) / (top0 - yMin)) * plotH;

  if (!points.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show yet.</p>;

  const line = points.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(Number(p.value) || 0).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(points.length - 1).toFixed(1)},${top + plotH} L${xAt(0).toFixed(1)},${top + plotH} Z`;
  const last = points[points.length - 1];
  const every = Math.max(1, Math.ceil(points.length / 7));

  const onMove = (e) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const ux = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(xAt(i) - ux) < Math.abs(xAt(best) - ux)) best = i;
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={MAIN} stopOpacity="0.14" />
            <stop offset="1" stopColor={MAIN} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {!compact &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={yAt(t)} y2={yAt(t)} stroke="currentColor" className="text-border" strokeWidth="1" />
              <text x={left - 8} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-muted-foreground tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
        {target != null && (
          <g>
            <line x1={left} x2={W - right} y1={yAt(target)} y2={yAt(target)} stroke="currentColor" className="text-muted-foreground" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
            {!compact && (
              <text x={left + 6} y={yAt(target) + 15} textAnchor="start" fontSize="11" fill="currentColor" className="text-muted-foreground">
                target {format(target)}
              </text>
            )}
          </g>
        )}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={MAIN} strokeWidth={compact ? 2 : 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {!compact &&
          points.map((p, i) =>
            showLabel(i, points.length, every) ? (
              <text key={p.key ?? i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground">
                {p.label}
              </text>
            ) : null
          )}
        {/* end value, labelled once */}
        <circle cx={xAt(points.length - 1)} cy={yAt(Number(last.value) || 0)} r="4.5" fill={MAIN} stroke="hsl(var(--card))" strokeWidth="2" />
        {compact && (
          <text x={xAt(points.length - 1) + 8} y={yAt(Number(last.value) || 0) + 4} fontSize="20" fontWeight="600" fill="currentColor" className="text-foreground tabular-nums">
            {last.display ?? format(Number(last.value) || 0)}
          </text>
        )}
        {h && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={top} y2={top + plotH} stroke="currentColor" className="text-muted-foreground" strokeWidth="1" />
            <circle cx={xAt(hover)} cy={yAt(Number(h.value) || 0)} r="5" fill={MAIN} stroke="hsl(var(--card))" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && <Readout x={(xAt(hover) / W) * 100} y={(yAt(Number(h.value) || 0) / H) * 100} value={h.display ?? format(Number(h.value) || 0)} label={h.label} />}
    </div>
  );
}

/**
 * Columns: one value per category or period. points: [{ key, label, value, display? }].
 * Each column is its own hover/focus target; compact hides axes.
 */
export function ColumnsChart({ points = [], height = 220, compact = false, format = compactNum, ariaLabel = "Columns" }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const top = compact ? 8 : 16;
  const bottom = compact ? 4 : 28;
  const left = compact ? 2 : 44;
  const right = compact ? 2 : 12;
  const max = Math.max(1, ...points.map((p) => Number(p.value) || 0));
  const ticks = niceTicks(max);
  const top0 = ticks[ticks.length - 1];
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const slot = plotW / Math.max(1, points.length);
  const bar = Math.max(3, Math.min(24, slot - 4)); // <= 24, and a gap between neighbours
  const yAt = (v) => top + plotH - (Math.max(0, v) / top0) * plotH;
  const every = Math.max(1, Math.ceil(points.length / 8));

  if (!points.some((p) => Number(p.value) > 0)) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show yet.</p>;

  const h = hover != null ? points[hover] : null;
  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label={ariaLabel}>
        {!compact &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={yAt(t)} y2={yAt(t)} stroke="currentColor" className="text-border" strokeWidth="1" />
              <text x={left - 8} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-muted-foreground tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
        {points.map((p, i) => {
          const v = Number(p.value) || 0;
          const x = left + slot * i + (slot - bar) / 2;
          const y = yAt(v);
          const hgt = top + plotH - y;
          const r = Math.min(4, bar / 2, hgt);
          // rounded data end, square at the baseline
          const d = hgt <= 0 ? "" : `M${x},${top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${top + plotH} Z`;
          return (
            <g key={p.key ?? p.label ?? i}>
              {/* hit target: the whole slot, taller than the bar */}
              <rect
                x={left + slot * i}
                y={top}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={compact ? -1 : 0}
                aria-label={`${p.label}: ${p.display ?? format(v)}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              />
              {d && <path d={d} fill={MAIN} opacity={hover == null || hover === i ? 1 : 0.45} pointerEvents="none" />}
              {!compact && (showLabel(i, points.length, every)) && (
                <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground" pointerEvents="none">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        {!compact && <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} stroke="currentColor" className="text-border" />}
      </svg>
      {h && (
        <Readout
          x={((left + slot * hover + slot / 2) / W) * 100}
          y={(yAt(Number(h.value) || 0) / H) * 100}
          value={h.display ?? format(Number(h.value) || 0)}
          label={h.label}
        />
      )}
    </div>
  );
}

/** Ranked horizontal bars (subjects, classes): label, bar, value at the tip. items: [{ key, label, value, display? }] */
export function RankBars({ items = [], max, compact = false, limit, format = compactNum }) {
  const top = Math.max(1, max ?? Math.max(...items.map((i) => Number(i.value) || 0)));
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show yet.</p>;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {shown.map((it) => (
        <li key={it.key ?? it.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${it.label}: ${it.display ?? format(it.value)}`}>
          <span className="truncate text-muted-foreground">{it.label}</span>
          <span className={`${compact ? "h-2" : "h-3"} overflow-hidden rounded-r bg-muted`}>
            <span className="block h-full rounded-r" style={{ width: `${Math.max(1.5, ((Number(it.value) || 0) / top) * 100)}%`, background: MAIN }} />
          </span>
          <span className="w-14 text-right font-medium tabular-nums">{it.display ?? format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The card: title, headline value, a compact chart. Opens big on demand.
 * chart(size) returns the chart for "compact" or "full"; table: { columns, rows }
 * gives the exact numbers in the big view.
 */
export function ChartCard({ title, value, caption, chart, table, className = "", note }) {
  const [open, setOpen] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const compactChart = chart("compact");
  return (
    <>
      <section
        className={`group relative cursor-pointer rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow ${className}`}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(true))}
        role="button"
        tabIndex={0}
        aria-label={`${title}: open the full chart`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
            {value != null && <div className="mt-0.5 text-xl font-semibold">{value}</div>}
            {caption && <div className="truncate text-xs text-muted-foreground">{caption}</div>}
          </div>
          <span className="rounded-md p-1 text-muted-foreground transition group-hover:bg-muted group-hover:text-foreground" aria-hidden="true">
            <Maximize2 className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-2">{compactChart}</div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {value != null && <span className="mr-2 text-base font-semibold text-foreground">{value}</span>}
                {caption}
              </DialogDescription>
            </div>
            {table && (
              <Button size="sm" variant="outline" onClick={() => setAsTable((x) => !x)}>
                {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
                {asTable ? "Chart" : "Table"}
              </Button>
            )}
          </div>
          {asTable && table ? (
            <div className="max-h-[60vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {table.columns.map((c, i) => (
                      <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {r.map((cell, j) => (
                        <td key={j} className={`px-3 py-1.5 ${j ? "text-right tabular-nums" : ""}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pt-2">{chart("full")}</div>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
