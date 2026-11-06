/** Small dependency-free SVG bar charts (single series + grouped two-series).
 * Colors come from --chart-1 / --chart-2 (validated for CVD in light + dark).
 * Every bar has a hover/focus tooltip; a visually hidden table mirrors the data. */
import { useState } from 'react';

export interface Series { key: string; label: string; color: 1 | 2; values: number[] }

interface Props {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  /** Short axis tick label (e.g. compact money). */
  tick?: (v: number) => string;
  height?: number;
  caption: string;
  /** Shown over the plot when every value is zero. */
  emptyText?: string;
}

const W = 640;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function BarChart({ labels, series, format, tick, height = 220, caption, emptyText }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, labels.length);
  const groupW = Math.min(band * 0.7, series.length === 1 ? 36 : 44);
  const gap = 2;
  const barW = (groupW - gap * (series.length - 1)) / series.length;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const fmtTick = tick ?? format;
  // Drop ticks whose label would repeat (e.g. 0.5 rounding to 1 on count axes).
  const ticks = [0, max / 2, max].filter((v, i, a) => a.findIndex((w) => fmtTick(w) === fmtTick(v)) === i);
  const empty = series.every((s) => s.values.every((v) => !v));

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={caption} style={{ direction: 'ltr' }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tv)} y2={y(tv)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tv)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">{fmtTick(tv)}</text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const gx = PAD.left + band * i + (band - groupW) / 2;
          return (
            <g key={lab + i} tabIndex={0} role="button" aria-label={`${lab}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none">
              {/* Hit target larger than the marks. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="transparent" />
              {hover === i && <rect x={PAD.left + band * i + 2} y={PAD.top} width={band - 4} height={innerH} rx={4} className="fill-surface-2" />}
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const top = y(v);
                const h = Math.max(0, PAD.top + innerH - top);
                const x = gx + si * (barW + gap);
                const r = Math.min(4, barW / 2, h);
                // Rounded data end, square at the baseline.
                const d = h <= 0 ? '' : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
                return d ? <path key={s.key} d={d} style={{ fill: `rgb(var(--chart-${s.color}))` }} /> : null;
              })}
              <text x={PAD.left + band * i + band / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{lab}</text>
            </g>
          );
        })}
      </svg>
      {empty && emptyText && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6">
          <span className="rounded-md bg-surface px-3 py-1.5 text-sm text-muted">{emptyText}</span>
        </div>
      )}
      {hover !== null && !empty && (
        <div className="pointer-events-none absolute top-0 z-10 min-w-[9rem] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${Math.min(78, Math.max(0, ((PAD.left + band * hover + band / 2) / W) * 100 - 10))}%` }}>
          <div className="mb-1 font-semibold text-fg">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: `rgb(var(--chart-${s.color}))` }} />{s.label}</span>
              <span className="tabular font-medium text-fg">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `rgb(var(--chart-${s.color}))` }} />{s.label}</span>
          ))}
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col" />{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
        <tbody>{labels.map((lab, i) => <tr key={lab + i}><th scope="row">{lab}</th>{series.map((s) => <td key={s.key}>{format(s.values[i] ?? 0)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}
