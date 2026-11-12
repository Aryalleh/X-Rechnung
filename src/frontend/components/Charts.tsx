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

/** Smooth single-series area/line chart with point markers and a hover tooltip. */
export function LineChart({ labels, values, format, tick, height = 260, caption, emptyText, seriesLabel }: {
  labels: string[]; values: number[]; format: (v: number) => string; tick?: (v: number) => string;
  height?: number; caption: string; emptyText?: string; seriesLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const max = niceMax(Math.max(0, ...values));
  const innerW = W - PAD.left - PAD.right - 8;
  const innerH = H - PAD.top - PAD.bottom;
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.left + 4 + (innerW * i) / n;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const fmtTick = tick ?? format;
  const ticks = [0, max / 3, (2 * max) / 3, max].filter((v, i, a) => a.findIndex((w) => fmtTick(w) === fmtTick(v)) === i);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  // Catmull-Rom → cubic Bézier for a smooth curve through every point.
  let d = pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const area = pts.length ? `${d} L${pts[pts.length - 1]![0]},${PAD.top + innerH} L${pts[0]![0]},${PAD.top + innerH} Z` : '';
  const empty = values.every((v) => !v);
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={caption} style={{ direction: 'ltr' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tv)} y2={y(tv)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tv)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">{fmtTick(tv)}</text>
          </g>
        ))}
        {!empty && <path d={area} style={{ fill: 'rgb(var(--chart-1) / 0.08)' }} />}
        {!empty && <path d={d} fill="none" strokeWidth={2.5} strokeLinecap="round" style={{ stroke: 'rgb(var(--chart-1))' }} />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-line-strong" strokeDasharray="3 3" />}
        {!empty && pts.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r={hover === i ? 6 : 4.5} className="stroke-surface" strokeWidth={2} style={{ fill: 'rgb(var(--chart-1))' }} />
        ))}
        {labels.map((lab, i) => (
          <g key={lab + i} tabIndex={0} role="button" aria-label={`${lab}: ${format(values[i] ?? 0)}`} className="outline-none"
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
            <rect x={x(i) - innerW / n / 2} y={PAD.top} width={innerW / n} height={innerH} fill="transparent" />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{lab}</text>
          </g>
        ))}
      </svg>
      {empty && emptyText && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6">
          <span className="rounded-md bg-surface px-3 py-1.5 text-sm text-muted">{emptyText}</span>
        </div>
      )}
      {hover !== null && !empty && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${Math.min(80, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}>
          <div className="font-semibold text-fg">{labels[hover]}</div>
          <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: 'rgb(var(--chart-1))' }} />{seriesLabel}: <span className="tabular font-medium text-fg">{format(values[hover] ?? 0)}</span></div>
        </div>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>{labels.map((lab, i) => <tr key={lab + i}><th scope="row">{lab}</th><td>{format(values[i] ?? 0)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Donut for parts of a whole (max 4 slices; the caller folds the rest into "Others"). */
export function Donut({ slices, format, caption, emptyText }: {
  slices: { label: string; value: number }[]; format: (v: number) => string; caption: string; emptyText: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  // One hue, four steps (light → dark reads as "share of open amount"); legend + values carry identity.
  const shades = ['rgb(var(--chart-1))', 'rgb(var(--chart-1) / 0.7)', 'rgb(var(--chart-1) / 0.45)', 'rgb(var(--chart-1) / 0.22)'];
  const R = 80, r = 52, C = 100;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const a1 = a0 + (total ? (s.value / total) * Math.PI * 2 : 0);
    const gap = slices.length > 1 ? 0.012 : 0;
    const [s0, s1] = [a0 + gap, Math.max(a0 + gap, a1 - gap)];
    const large = s1 - s0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const d = slices.length === 1
      ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r} A${r},${r} 0 1 0 ${C},${C - r} Z`
      : `M${p(s0, R)} A${R},${R} 0 ${large} 1 ${p(s1, R)} L${p(s1, r)} A${r},${r} 0 ${large} 0 ${p(s0, r)} Z`;
    a0 = a1;
    return { d, fill: shades[i] ?? shades[3]!, s, i };
  });
  if (!total) return <div className="flex h-48 items-center justify-center text-sm text-muted">{emptyText}</div>;
  return (
    <figure className="flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 200 200" className="h-52 w-52" role="img" aria-label={caption}>
          {arcs.map((a) => (
            <path key={a.i} d={a.d} style={{ fill: a.fill }} className="stroke-surface outline-none" strokeWidth={hover === a.i ? 0 : 1}
              tabIndex={0} onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(a.i)} onBlur={() => setHover(null)}
              transform={hover === a.i ? `translate(${0},${0}) scale(1.03)` : undefined} transform-origin="100 100" />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[7rem] truncate text-[11px] text-muted">{hover !== null ? slices[hover]!.label : caption}</span>
          <span className="tabular text-sm font-bold">{format(hover !== null ? slices[hover]!.value : total)}</span>
        </div>
      </div>
      <figcaption className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {arcs.map((a) => (
          <span key={a.i} className="flex min-w-0 items-center gap-2 text-muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.fill }} />
            <bdi className="truncate">{a.s.label}</bdi>
          </span>
        ))}
      </figcaption>
      <table className="sr-only"><caption>{caption}</caption><tbody>{slices.map((s) => <tr key={s.label}><th scope="row">{s.label}</th><td>{format(s.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}
