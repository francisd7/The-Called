/**
 * A number's recent shape, at the size of a line of text.
 *
 * No axes, no grid, no labels - the figure beside it carries the value, and
 * this only has to answer "which way, and how steadily". The last point is
 * drawn because that is the one the number above refers to.
 */
export function Sparkline({
  points,
  tone = 'accent',
  width = 104,
  height = 26,
}: {
  points: number[];
  tone?: 'accent' | 'ok' | 'warn';
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;

  const pad = 3;
  const max = Math.max(...points);
  const min = Math.min(...points);
  // A flat run would divide by zero and, drawn at the top, would read as a
  // maximum; centre it instead.
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) =>
    max === min ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2);

  const line = points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${pad},${height} ${line} ${width - pad},${height}`;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);

  return (
    <svg
      className={`spark spark-${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend over the last ${points.length} days`}
    >
      <polygon className="spark-area" points={area} />
      <polyline className="spark-line" points={line} />
      <circle className="spark-end" cx={lastX} cy={lastY} r={2.5} />
    </svg>
  );
}

/** Change against the period before, as a pill that says which way. */
export function Delta({ now, before }: { now: number; before: number }) {
  // No previous figure means no comparison, rather than a made-up 100%.
  if (before === 0) {
    return now === 0 ? <span className="delta delta-flat">—</span> : <span className="delta delta-new">new</span>;
  }
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return <span className="delta delta-flat">level</span>;
  const up = change > 0;
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}%
    </span>
  );
}
