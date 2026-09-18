'use client';

import { useState } from 'react';
import type { Series } from '@/lib/kpis';

const PAD = { top: 16, right: 16, bottom: 30, left: 52 };
const W = 720;
const H = 260;

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
export function LineChart({
  series,
  format = (n: number) => String(n),
  tableCaption,
}: {
  series: Series[];
  format?: (n: number) => string;
  tableCaption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const xs = series[0]?.points.map((p) => p.x) ?? [];
  if (xs.length === 0 || series.length === 0) {
    return <p className="panel-empty">No data in this range.</p>;
  }

  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = xs.length === 1 ? plotW : plotW / (xs.length - 1);
  const x = (i: number) => (xs.length === 1 ? PAD.left + plotW / 2 : PAD.left + i * step);
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH;

  // Four gridlines is enough to read a value off; more is clutter.
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((maxY / 4) * i));
  const labelEvery = Math.ceil(xs.length / 6);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tableCaption} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {format(t)}
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
            <polyline
              className={`chart-line series-${si + 1}`}
              points={s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')}
            />
            {s.points.map((p, i) => (
              <circle
                key={p.x}
                cx={x(i)}
                cy={y(p.y)}
                r={hover === i ? 5 : 3.5}
                className={`chart-dot series-${si + 1}`}
              />
            ))}
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
            <span className={`chart-swatch series-${si + 1}`} />
            {s.label}
            {hover !== null && <strong>{format(s.points[hover]?.y ?? 0)}</strong>}
          </span>
        ))}
        <span className="chart-legend-when">
          {hover !== null ? `w/c ${shortDate(xs[hover])}` : 'hover for weekly values'}
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
                <th>Week</th>
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
                    <td key={s.key}>{format(s.points[i]?.y ?? 0)}</td>
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
