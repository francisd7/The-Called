/**
 * Where a chart's gridlines go.
 *
 * Kept out of the chart component so the rule can be tested directly rather
 * than through a copy of itself that can drift.
 */

/** Multipliers a person would actually write on an axis. */
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];

/**
 * The gap between gridlines for a chart topping out at `max`, over four
 * intervals.
 *
 * A count's gridlines are whole numbers - "12.5 outbounds" is not a line
 * anybody wants to read a value off - so fractional steps are dropped rather
 * than rounded. Rounding is what produced an axis stepping by 13.
 */
export function niceStep(max: number, kind: 'number' | 'usd' = 'number'): number {
  const raw = Math.max(max, 1) / 4;
  const exponent = Math.floor(Math.log10(raw));
  const base = kind === 'usd' ? 10 ** exponent : Math.max(1, 10 ** exponent);

  const fits = STEPS.map((m) => m * base).filter(
    (step) => step >= raw && (kind === 'usd' || Number.isInteger(step))
  );
  // 10x the base always clears `raw`, so there is never no answer.
  return fits[0] ?? base * 10;
}
