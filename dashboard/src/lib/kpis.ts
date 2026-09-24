import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { teamDateString } from './dates.ts';
import type { Period } from './queries.ts';
import { colourOrder, personColour, type PersonColour } from './people.ts';
import { eodReports, leads, users } from '@/db/schema';

export type Range = { from: string; to: string };

/** Default window: the last 12 weeks, which is roughly the life of this data. */
export function defaultRange(): Range {
  const to = new Date();
  const from = new Date(to.getTime() - 84 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function bounds({ from, to }: Range) {
  // `to` is inclusive of its whole day, so compare against the following midnight.
  return { start: new Date(`${from}T00:00:00Z`), end: new Date(`${to}T23:59:59.999Z`) };
}

/** Monday-anchored week buckets, so a chart has a point per week even at zero. */
function weekBuckets({ from, to }: Range): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  const last = new Date(`${to}T12:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

const notTest = eq(leads.isTest, false);

/**
 * Leads → replied → call booked → showed → closed, counted over the window by
 * when the lead was created. Each step counts leads that reached it at all, so
 * the bars only ever go down.
 */
export async function funnel(range: Range, setterId?: string) {
  const { start, end } = bounds(range);
  const scope = [notTest, gte(leads.leadCreatedAt, start), lte(leads.leadCreatedAt, end)];
  if (setterId) scope.push(eq(leads.setterId, setterId));

  // Each step counts leads that got AT LEAST this far, so a later step implies
  // the earlier ones. Counting the raw flags instead produced a funnel where
  // more leads had booked a call than had replied - the Airtable "Responded?"
  // checkbox simply wasn't ticked on rows that plainly did reply, and a funnel
  // that goes up is worse than useless.
  const [row] = await db
    .select({
      leadsIn: sql<number>`COUNT(*)::int`,
      replied: sql<number>`COUNT(*) FILTER (WHERE ${leads.responded} OR ${leads.callBooked} OR ${leads.showed} OR ${leads.closed})::int`,
      booked: sql<number>`COUNT(*) FILTER (WHERE ${leads.callBooked} OR ${leads.showed} OR ${leads.closed})::int`,
      showed: sql<number>`COUNT(*) FILTER (WHERE ${leads.showed} OR ${leads.closed})::int`,
      closed: sql<number>`COUNT(*) FILTER (WHERE ${leads.closed})::int`,
    })
    .from(leads)
    .where(and(...scope));

  return [
    { step: 'Leads', value: row.leadsIn },
    { step: 'Replied', value: row.replied },
    { step: 'Call booked', value: row.booked },
    { step: 'Showed', value: row.showed },
    { step: 'Closed', value: row.closed },
  ];
}

/**
 * A null y is "we don't know", not zero - a day nobody filed a report is not a
 * day of no work, and a chart that draws it at the baseline says it was.
 */
export type Series = {
  key: string;
  label: string;
  points: Array<{ x: string; y: number | null }>;
  /**
   * Set only where a series stands for a person, and then it is their own
   * colour - the same one their tile and their name badge wear. Without it,
   * filtering to one setter repainted whoever survived as series 1, and the
   * tracker and the charts disagreed about who was what colour anyway.
   *
   * Series that are not people (cash against contract, outbounds against
   * replies) leave it unset and take the generic series palette.
   */
  person?: PersonColour;
};


/** Calls booked per week, one series per setter (plus unassigned when present). */
export async function callsBooked(range: Range, setterId?: string): Promise<Series[]> {
  const { start, end } = bounds(range);
  const scope = [notTest, isNotNull(leads.callBookedAt), gte(leads.callBookedAt, start), lte(leads.callBookedAt, end)];
  if (setterId) scope.push(eq(leads.setterId, setterId));

  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${leads.callBookedAt}), 'YYYY-MM-DD')`,
      setterId: leads.setterId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(and(...scope))
    .groupBy(sql`1`, leads.setterId)
    .orderBy(asc(sql`1`));

  const people = await db.select().from(users).orderBy(asc(users.name));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  // One fixed order, spanning only the people who can hold a lead - not just
  // whoever booked something in this range, or the colours would shift with the
  // date picker, and not the closers either, who would spend slots the chart
  // never draws.
  const order = colourOrder(people);
  const buckets = weekBuckets(range);
  const keys = [...new Set(rows.map((r) => r.setterId ?? 'none'))];

  return keys.map((key) => ({
    key,
    label: key === 'none' ? 'Unassigned' : (nameOf.get(key) ?? 'Unknown'),
    person: key === 'none' ? undefined : personColour({ id: key }, order),
    points: buckets.map((week) => ({
      x: week,
      y: rows.find((r) => r.week === week && (r.setterId ?? 'none') === key)?.n ?? 0,
    })),
  }));
}

/** Cash collected and contract value per week, by when the deal closed. */
export async function money(range: Range, setterId?: string): Promise<Series[]> {
  const { start, end } = bounds(range);
  const scope = [notTest, isNotNull(leads.closedDate), gte(leads.closedDate, start), lte(leads.closedDate, end)];
  if (setterId) scope.push(eq(leads.setterId, setterId));

  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${leads.closedDate}), 'YYYY-MM-DD')`,
      cash: sql<number>`COALESCE(SUM(${leads.cashCollected}), 0)::float`,
      contract: sql<number>`COALESCE(SUM(${leads.contractValue}), 0)::float`,
    })
    .from(leads)
    .where(and(...scope))
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`));

  const buckets = weekBuckets(range);
  const pick = (field: 'cash' | 'contract') =>
    buckets.map((week) => ({ x: week, y: rows.find((r) => r.week === week)?.[field] ?? 0 }));

  // Both are dollars, so they share one axis honestly. Two measures on two
  // scales would need two charts.
  return [
    { key: 'cash', label: 'Cash collected', points: pick('cash') },
    { key: 'contract', label: 'Contract value', points: pick('contract') },
  ];
}

/** Outreach activity per week, from what setters type into their EOD reports. */
export async function outreach(range: Range, setterId?: string): Promise<Series[]> {
  const scope = [gte(eodReports.reportDate, range.from), lte(eodReports.reportDate, range.to)];
  if (setterId) scope.push(eq(eodReports.userId, setterId));

  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${eodReports.reportDate}::date), 'YYYY-MM-DD')`,
      outbounds: sql<number>`COALESCE(SUM(${eodReports.totalOutbounds}), 0)::int`,
      followUps: sql<number>`COALESCE(SUM(${eodReports.totalFollowUps}), 0)::int`,
      replies: sql<number>`COALESCE(SUM(${eodReports.totalLeadsWithReplies}), 0)::int`,
    })
    .from(eodReports)
    .where(and(...scope))
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`));

  const buckets = weekBuckets(range);
  const pick = (field: 'outbounds' | 'followUps' | 'replies') =>
    buckets.map((week) => ({ x: week, y: rows.find((r) => r.week === week)?.[field] ?? 0 }));

  return [
    { key: 'outbounds', label: 'Outbounds', points: pick('outbounds') },
    { key: 'followUps', label: 'Follow-ups', points: pick('followUps') },
    { key: 'replies', label: 'Replies', points: pick('replies') },
  ];
}

/**
 * The recent shape of the headline numbers, in the same units as the tiles.
 *
 * The buttons above those tiles switch between today, this week and this
 * month, so the line under them has to switch too - fourteen days against a
 * monthly figure would be two different questions stacked on top of each other.
 *
 * The comparison is against the *same point* in the previous period, not the
 * whole of it. On a Tuesday, "down 60% on last week" is otherwise just a
 * statement that the week is two days old.
 */
export type PeriodTrend = { series: number[]; now: number; before: number };

const UNIT: Record<Period, 'day' | 'week' | 'month'> = {
  today: 'day',
  week: 'week',
  month: 'month',
};

export async function periodTrends(
  period: Period
): Promise<{ calls: PeriodTrend; newLeads: PeriodTrend; cash: PeriodTrend; deals: PeriodTrend }> {
  const unit = UNIT[period];
  const buckets = unit === 'day' ? 14 : 12;
  const tz = sql.raw("'America/New_York'");
  const u = sql.raw(`'${unit}'`);
  const back = sql.raw(String(buckets - 1));

  // Local time throughout: a call at 8pm belongs to that evening, not to the
  // next day in UTC.
  const local = (col: PgColumn) => sql`(${col} AT TIME ZONE ${tz})`;
  const bucketOf = (col: PgColumn) => sql`date_trunc(${u}, ${local(col)})`;
  const thisBucket = sql`date_trunc(${u}, (NOW() AT TIME ZONE ${tz}))`;
  const firstBucket = sql`${thisBucket} - (${back} * INTERVAL '1 ${sql.raw(unit)}')`;
  // How far into the current period we are, to cut the previous one at the
  // same place.
  const elapsed = sql`((NOW() AT TIME ZONE ${tz}) - ${thisBucket})`;

  async function trend(col: PgColumn, value: 'count' | 'cash', extra = sql`TRUE`): Promise<PeriodTrend> {
    const agg =
      value === 'count'
        ? sql<number>`COUNT(*)::int`
        : sql<number>`COALESCE(SUM(${leads.cashCollected}), 0)::float`;
    const base = and(eq(leads.isTest, false), isNotNull(col), extra);

    const rows = await db
      .select({ b: sql<string>`${bucketOf(col)}`, n: agg })
      .from(leads)
      .where(and(base, sql`${bucketOf(col)} >= ${firstBucket}`))
      .groupBy(sql`1`);

    const [{ n: before }] = await db
      .select({ n: agg })
      .from(leads)
      .where(
        and(
          base,
          sql`${local(col)} >= ${thisBucket} - INTERVAL '1 ${sql.raw(unit)}'`,
          sql`${local(col)} < ${thisBucket} - INTERVAL '1 ${sql.raw(unit)}' + ${elapsed}`
        )
      );

    // Every bucket in the window, so a quiet week is a zero in the line rather
    // than a gap that makes the shape lie.
    const by = new Map(rows.map((r) => [new Date(r.b).getTime(), Number(r.n)]));
    const series: number[] = [];
    const anchor = new Date();
    for (let i = buckets - 1; i >= 0; i--) {
      const d = new Date(anchor);
      if (unit === 'day') d.setDate(d.getDate() - i);
      else if (unit === 'week') d.setDate(d.getDate() - i * 7);
      else d.setMonth(d.getMonth() - i);
      const key = [...by.keys()].find((k) => Math.abs(k - truncate(d, unit)) < 36e5);
      series.push(key !== undefined ? by.get(key)! : 0);
    }
    const now = series[series.length - 1] ?? 0;
    return { series, now, before: Number(before) };
  }

  const [calls, newLeads, cash, deals] = await Promise.all([
    // callBookedAt, not callScheduledFor: the tile above this line counts the
    // day a booking was made, and a line drawn on the day the call happens
    // would quietly disagree with the number it sits under.
    trend(leads.callBookedAt, 'count', eq(leads.callBooked, true)),
    trend(leads.leadCreatedAt, 'count'),
    trend(leads.closedDate, 'cash', sql`${leads.closed} IS TRUE`),
    trend(leads.closedDate, 'count', sql`${leads.closed} IS TRUE`),
  ]);
  return { calls, newLeads, cash, deals };
}

/** Start of the bucket a date falls in, in local terms, as epoch ms. */
function truncate(d: Date, unit: 'day' | 'week' | 'month'): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  if (unit === 'week') {
    // Postgres date_trunc('week') starts on Monday.
    const dow = (c.getDay() + 6) % 7;
    c.setDate(c.getDate() - dow);
  } else if (unit === 'month') {
    c.setDate(1);
  }
  return c.getTime();
}
