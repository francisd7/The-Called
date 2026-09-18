/**
 * Turning a week of EOD rows into the table an admin reads.
 *
 * Kept free of database imports so it can be tested directly - the shape of
 * this summary is the thing worth being sure about, not the query that feeds
 * it.
 */

/** The counted fields, in the order they read best across a row. */
export const EOD_COUNTS = [
  { key: 'totalOutbounds', label: 'Outbounds' },
  { key: 'totalFollowUps', label: 'Follow-ups' },
  { key: 'totalLeadsWithReplies', label: 'Replies' },
  { key: 'youtubeVideosSent', label: 'YT sent' },
  { key: 'callsPitched', label: 'Pitched' },
  { key: 'callsBooked', label: 'Booked' },
] as const;

export const EOD_MONEY = [
  { key: 'cashCollected', label: 'Cash' },
  { key: 'revenueGenerated', label: 'Revenue' },
] as const;

export type CountKey = (typeof EOD_COUNTS)[number]['key'];
export type MoneyKey = (typeof EOD_MONEY)[number]['key'];
export type EodTotals = Record<CountKey | MoneyKey, number>;

export type PersonLike = { id: string; name: string; color: string | null };
export type ReportLike = { userId: string; reportDate: string } & {
  [K in CountKey]?: number | null;
} & { [K in MoneyKey]?: string | number | null };

export function emptyEodTotals(): EodTotals {
  const totals = {} as EodTotals;
  for (const f of EOD_COUNTS) totals[f.key] = 0;
  for (const f of EOD_MONEY) totals[f.key] = 0;
  return totals;
}

function add(totals: EodTotals, report: ReportLike) {
  for (const f of EOD_COUNTS) totals[f.key] += report[f.key] ?? 0;
  // Money arrives from Postgres as a numeric string, not a number.
  for (const f of EOD_MONEY) totals[f.key] += Number(report[f.key] ?? 0);
}

/**
 * Built around the people rather than the rows, so a setter who filed nothing
 * all week is a row of blanks rather than absent from the table - which is the
 * one thing this view exists to show.
 */
export function summariseEodWeek<P extends PersonLike, R extends ReportLike>({
  people,
  rows,
  days,
}: {
  people: P[];
  rows: R[];
  days: string[];
}) {
  const team = emptyEodTotals();

  const summarised = people.map((person) => {
    const mine = rows.filter((r) => r.userId === person.id && days.includes(r.reportDate));
    const totals = emptyEodTotals();
    for (const r of mine) {
      add(totals, r);
      add(team, r);
    }
    return {
      ...person,
      filed: mine.length,
      byDay: new Map(mine.map((r) => [r.reportDate, r])),
      totals,
      reports: mine,
    };
  });

  return { people: summarised, team };
}
