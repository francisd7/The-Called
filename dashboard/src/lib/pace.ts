/**
 * How far through a month you are, and whether the number is keeping up.
 *
 * Counted in working days, not calendar days. A team that works weekdays is
 * "behind" every Monday and "ahead" every Friday on a calendar-day measure,
 * which makes the bar noise rather than information.
 */
export type Pace = {
  /** 0-1: how much of the month's working time has gone. */
  elapsed: number;
  /** 0-1, clamped for drawing: how much of the target is done. */
  done: number;
  /** What the figure would need to be today to be exactly on pace. */
  expected: number;
  ahead: boolean;
  /** Never null here: no target means paceFor returns nothing at all, because
   *  a goal nobody set is not a goal being missed. */
  target: number;
};

export function workingDaysInMonth(year: number, month: number): number {
  let n = 0;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const day = new Date(Date.UTC(year, month, d)).getUTCDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

export function workingDaysElapsed(year: number, month: number, dayOfMonth: number): number {
  let n = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    const day = new Date(Date.UTC(year, month, d)).getUTCDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

export function paceFor(actual: number, target: number | null, on: Date): Pace | null {
  if (target === null || target <= 0) return null;

  const year = on.getUTCFullYear();
  const month = on.getUTCMonth();
  const total = workingDaysInMonth(year, month);
  const gone = workingDaysElapsed(year, month, on.getUTCDate());
  const elapsed = total === 0 ? 0 : gone / total;
  const expected = target * elapsed;

  return {
    elapsed,
    done: Math.max(0, Math.min(1, actual / target)),
    expected,
    // On the first working day nothing is expected yet, so anything at all is
    // ahead rather than behind.
    ahead: actual >= expected,
    target,
  };
}
