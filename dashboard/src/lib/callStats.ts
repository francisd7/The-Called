/**
 * What a set of booked calls adds up to.
 *
 * Kept apart from the query because the honest part of a page like this is the
 * denominators, and those are worth being able to test on their own. A show
 * rate over the wrong bottom half is the kind of number a decision gets made
 * on and nobody checks.
 */

export type CallRow = {
  cancelled: boolean;
  /** Null while nobody has recorded what happened. */
  showed: boolean | null;
  closed: boolean | null;
  settled: boolean;
  cashCollected: string | number | null;
  contractValue: string | number | null;
};

export type CallStats = {
  booked: number;
  cancelled: number;
  /** Booked minus cancelled: the calls that were meant to happen. */
  held: number;
  /** Of the held calls, the ones somebody has recorded a result for. */
  settled: number;
  showed: number;
  noShowed: number;
  closed: number;
  cash: number;
  contract: number;
  /** Showed over settled, because an unrecorded call is not a no-show. */
  showRate: number | null;
  /** Closed over showed: you cannot close somebody who never turned up. */
  closeRate: number | null;
  cancelRate: number | null;
  /** Cash over the calls that showed - what a held call is worth. */
  cashPerShow: number | null;
};

const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const rate = (top: number, bottom: number): number | null => (bottom === 0 ? null : top / bottom);

export function summariseCalls(rows: CallRow[]): CallStats {
  const booked = rows.length;
  const cancelled = rows.filter((r) => r.cancelled).length;
  const held = rows.filter((r) => !r.cancelled);
  const settled = held.filter((r) => r.settled);
  const showed = settled.filter((r) => r.showed === true).length;
  const closed = held.filter((r) => r.closed === true).length;

  return {
    booked,
    cancelled,
    held: held.length,
    settled: settled.length,
    showed,
    // Only among calls somebody has recorded. A call still waiting on its
    // outcome is unknown, not a no-show, and counting it as one would make
    // every week look worse than it was until the paperwork caught up.
    noShowed: settled.length - showed,
    closed,
    cash: held.reduce((a, r) => a + num(r.cashCollected), 0),
    contract: held.reduce((a, r) => a + num(r.contractValue), 0),
    showRate: rate(showed, settled.length),
    closeRate: rate(closed, showed),
    cancelRate: rate(cancelled, booked),
    cashPerShow: rate(held.reduce((a, r) => a + num(r.cashCollected), 0), showed),
  };
}
