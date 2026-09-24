import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { eodReports, leadEvents, users } from '@/db/schema';
import { streakFromDays } from './streakMath.ts';
import { colourOrder, personColour } from './people.ts';

export type StreakRow = {
  userId: string;
  name: string;
  color: string | null;
  tracker: { current: number; aliveToday: boolean };
  eod: { current: number; aliveToday: boolean };
};

/**
 * Two streaks per setter: days they touched the tracker, and days they filed an
 * EOD. Only the last 120 days are scanned - a streak longer than that is not
 * the problem this is trying to solve.
 */
export async function getStreaks(): Promise<StreakRow[]> {
  const since = new Date(Date.now() - 120 * 86_400_000);

  const [everyone, trackerDays, eodDays] = await Promise.all([
    // Everyone, not just the setters on this strip: the colour order has to be
    // the same one the tiles and the charts use, or the same person is two
    // colours on one screen.
    db.select().from(users),
    db
      .select({
        actorId: leadEvents.actorId,
        // Bucketed in the team's timezone, so "today" means their day.
        day: sql<string>`to_char(${leadEvents.createdAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`,
      })
      .from(leadEvents)
      .where(gte(leadEvents.createdAt, since))
      .groupBy(leadEvents.actorId, sql`2`),
    db
      .select({ userId: eodReports.userId, day: eodReports.reportDate })
      .from(eodReports)
      .where(gte(eodReports.reportDate, since.toISOString().slice(0, 10))),
  ]);

  const order = colourOrder(everyone);
  const setters = everyone
    .filter((u) => u.active && u.role === 'setter')
    .sort((a, b) => a.name.localeCompare(b.name));

  return setters.map((s) => ({
    userId: s.id,
    name: s.name,
    color: personColour(s, order),
    tracker: streakFromDays(
      new Set(trackerDays.filter((d) => d.actorId === s.id).map((d) => d.day))
    ),
    eod: streakFromDays(new Set(eodDays.filter((d) => d.userId === s.id).map((d) => d.day))),
  }));
}

