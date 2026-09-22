'use client';

import { useState } from 'react';
import type { Series } from '@/lib/kpis';
import { niceStep } from '@/lib/chartScale';

const PAD = { top: 16, right: 16, bottom: 30, left: 52 };

const W = 720;
const H = 260;


/** Splits a series into the unbroken runs between its gaps. */
function runs(points: Series['points']): Array<Array<{ i: number; v: number }>> {
  const out: Array<Array<{ i: number; v: number }>> = [];
  let current: Array<{ i: number; v: number }> = [];
  points.forEach((p, i) => {
    if (p.y === null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current.push({ i, v: p.y });
  });
  if (current.length > 0) out.push(current);
  // A lone point has no line to draw; it still gets its dot.
  return out.filter((r) => r.length > 1);
}

function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * One y-axis, always. Two measures on different scales get two charts rather
 * than a second axis - a dual axis invites the reader to infer a relationship
 * the data doesn't support.
 */
const FORMATS = {
  number: (n: number) => n.toLocaleString(),
  usd: (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
} as const;

/**
 * `format` is a name rather than a function: a server component can't hand a
 * function to a client one, and doing so fails at request time with an error
 * that names the prop but not the page.
 */
export function LineChart({
  series,
  format = 'number',
  tableCaption,
  xUnit = 'week',
}: {
  series: Series[];
  format?: keyof typeof FORMATS;
  tableCaption: string;
  /** What one point covers, which is all that changes in the hover label. */
  xUnit?: 'day' | 'week';
}) {
  const fmt = FORMATS[format] ?? FORMATS.number;
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const known = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v !== null);
  if (xs.length === 0 || series.length === 0 || known.length === 0) {
    return <p className="panel-empty">No data in this range.</p>;
  }

  // A tick of 18.75 is a number nobody reads off an axis. Pick a round step
  // first and let the top of the scale fall where it does.
  const step4 = niceStep(Math.max(1, ...known), format);
  const maxY = step4 * 4;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = xs.length === 1 ? plotW : plotW / (xs.length - 1);
  const x = (i: number) => (xs.length === 1 ? PAD.left + plotW / 2 : PAD.left + i * step);
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH;

  // Four gridlines is enough to read a value off; more is clutter.
  const ticks = Array.from({ length: 5 }, (_, i) => step4 * i);
  const labelEvery = Math.ceil(xs.length / 6);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tableCaption} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}

        {xs.map((label, i) =>
          i % labelEvery === 0 ? (
            <text
              key={label}
              x={x(i)}
              y={H - 10}
              className="chart-tick"
              // The end labels anchor inward: centred, the last one runs off
              // the viewBox and gets clipped mid-word.
              textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}
            >
              {shortDate(label)}
            </text>
          ) : null
        )}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="chart-crosshair" />
        )}

        {series.map((s, si) => (
          <g key={s.key}>
            {/* One polyline per unbroken run. A gap is drawn as a gap rather
                than bridged, because joining across a day nobody reported would
                draw a trend through data that isn't there. */}
            {runs(s.points).map((run, ri) => (
              <polyline
                key={ri}
                className={`chart-line series-${s.tone ?? si + 1}`}
                points={run.map(({ i, v }) => `${x(i)},${y(v)}`).join(' ')}
              />
            ))}
            {s.points.map((p, i) =>
              p.y === null ? null : (
                <circle
                  key={p.x}
                  cx={x(i)}
                  cy={y(p.y)}
                  r={hover === i ? 5 : 3.5}
                  className={`chart-dot series-${s.tone ?? si + 1}`}
                />
              )
            )}
          </g>
        ))}

        {/* Invisible full-height bands - a hit target far bigger than the dots. */}
        {xs.map((label, i) => (
          <rect
            key={label}
            x={x(i) - step / 2}
            y={PAD.top}
            width={step}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {/* Identity is never colour alone: every series is named here, and the
          hovered value sits beside its name. */}
      <div className="chart-legend">
        {series.map((s, si) => (
          <span key={s.key} className="chart-legend-item">
            <span className={`chart-swatch series-${s.tone ?? si + 1}`} />
            {s.label}
            {hover !== null && (
              <strong>
                {s.points[hover]?.y === null || s.points[hover] === undefined
                  ? 'not reported'
                  : fmt(s.points[hover].y as number)}
              </strong>
            )}
          </span>
        ))}
        <span className="chart-legend-when">
          {hover !== null
            ? `${xUnit === 'week' ? 'w/c ' : ''}${shortDate(xs[hover])}`
            : `hover for ${xUnit === 'week' ? 'weekly' : 'daily'} values`}
        </span>
      </div>

      <button type="button" className="chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Hide table' : 'Show as table'}
      </button>

      {showTable && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{xUnit === 'week' ? 'Week' : 'Day'}</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((label, i) => (
                <tr key={label}>
                  <td>{shortDate(label)}</td>
                  {series.map((s) => (
                    <td key={s.key}>
                      {s.points[i]?.y === null || s.points[i] === undefined
                        ? '—'
                        : fmt(s.points[i].y as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
