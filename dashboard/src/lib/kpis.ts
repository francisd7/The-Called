import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { teamDateString } from './dates.ts';
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
 * The last N days of a handful of headline numbers, one point per day.
 *
 * For the sparklines on the dashboard: enough shape to say which way something
 * is going, at the size of a line of text. Keyed on the day a thing happened -
 * the call's own day, the day cash was collected - rather than the day the row
 * was written, which is the same rule the rest of the page follows.
 */
export async function dailyTrends(days = 14) {
  // Inlined rather than bound: a bound parameter arrives untyped, and
  // `date - $1` then compares as an integer. `days` is ours, not input.
  const back = sql.raw(String(Math.max(0, Math.floor(days) - 1)));
  const since = sql`((NOW() AT TIME ZONE 'America/New_York')::date - ${back})`;
  const day = (col: PgColumn) => sql<string>`(${col} AT TIME ZONE 'America/New_York')::date`;

  const [calls, newLeads, cash] = await Promise.all([
    db
      .select({ d: day(leads.callScheduledFor), n: sql<number>`COUNT(*)::int` })
      .from(leads)
      .where(and(eq(leads.isTest, false), eq(leads.callBooked, true), sql`${day(leads.callScheduledFor)} >= ${since}`))
      .groupBy(sql`1`),
    db
      .select({ d: day(leads.leadCreatedAt), n: sql<number>`COUNT(*)::int` })
      .from(leads)
      .where(and(eq(leads.isTest, false), sql`${day(leads.leadCreatedAt)} >= ${since}`))
      .groupBy(sql`1`),
    db
      .select({ d: day(leads.closedDate), n: sql<number>`COALESCE(SUM(${leads.cashCollected}), 0)::float` })
      .from(leads)
      .where(and(eq(leads.isTest, false), sql`${leads.closed} IS TRUE`, sql`${day(leads.closedDate)} >= ${since}`))
      .groupBy(sql`1`),
  ]);

  // Every day in the window, so a quiet day is a zero in the line rather than a
  // gap that makes the shape lie.
  const window = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return teamDateString(d);
  });
  const series = (rows: Array<{ d: string; n: number }>) => {
    const by = new Map(rows.map((r) => [String(r.d).slice(0, 10), Number(r.n)]));
    return window.map((d) => by.get(d) ?? 0);
  };

  return { days: window, calls: series(calls), newLeads: series(newLeads), cash: series(cash) };
}
