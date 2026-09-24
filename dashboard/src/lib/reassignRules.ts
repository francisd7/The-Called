/**
 * Moving leads between people by when they were created.
 *
 * The whole point of this is that cash is attributed to whoever owns the lead,
 * so getting a boundary wrong moves money onto the wrong person's numbers. The
 * rule is kept here, with no database attached, so the edges can be tested
 * rather than reasoned about.
 *
 * The pile being split can be the unassigned one - a blank Setter column in
 * the old tracker imports as nobody, so that is usually where a mislabelled
 * run of leads actually sits - which is why `fromSetterId` is nullable.
 *
 * Both dates are inclusive, and the three bands are stated the way they read:
 *
 *   created <  first            -> stays with the person it is already on
 *   first   <= created <= last  -> moves to `toSetterId`
 *   created >  last             -> unassigned
 */
export type ReassignRow = {
  id: string;
  setterId: string | null;
  /** YYYY-MM-DD in the team's timezone. */
  createdOn: string | null;
  cashCollected: string | number | null;
};

export type ReassignBand = 'before' | 'middle' | 'after';

export type ReassignPlan = {
  band: Record<ReassignBand, { leads: number; cash: number }>;
  moves: Array<{ id: string; to: string | null }>;
  /** Rows the rule could not place, because nobody recorded when they started. */
  undated: number;
};

const money = (v: string | number | null): number => {
  if (v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function bandFor(createdOn: string, first: string, last: string): ReassignBand {
  if (createdOn < first) return 'before';
  if (createdOn <= last) return 'middle';
  return 'after';
}

export function planReassign(
  rows: ReassignRow[],
  opts: { fromSetterId: string | null; first: string; last: string; toSetterId: string }
): ReassignPlan {
  const band: ReassignPlan['band'] = {
    before: { leads: 0, cash: 0 },
    middle: { leads: 0, cash: 0 },
    after: { leads: 0, cash: 0 },
  };
  const moves: ReassignPlan['moves'] = [];
  let undated = 0;

  for (const row of rows) {
    // Only the pile being split. Somebody else's lead is never touched by this.
    if (row.setterId !== opts.fromSetterId) continue;
    if (!row.createdOn) {
      undated += 1;
      continue;
    }

    const where = bandFor(row.createdOn, opts.first, opts.last);
    band[where].leads += 1;
    band[where].cash += money(row.cashCollected);

    // 'before' stays put, so it is counted but never moved.
    if (where === 'middle') moves.push({ id: row.id, to: opts.toSetterId });
    else if (where === 'after') moves.push({ id: row.id, to: null });
  }

  return { band, moves, undated };
}
