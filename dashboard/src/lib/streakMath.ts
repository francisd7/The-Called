import { teamDateString } from './dates.ts';

export type Streak = { current: number; aliveToday: boolean };

/**
 * Consecutive days ending today (or yesterday) that a person did the thing.
 *
 * Yesterday still counts as alive: a streak that dies at midnight punishes
 * someone for not having worked yet this morning, which makes the number
 * discouraging rather than motivating - the opposite of the point.
 *
 * Kept free of database imports so it can be tested directly.
 */
export function streakFromDays(days: Set<string>): Streak {
  const today = teamDateString();
  const cursor = new Date(`${today}T12:00:00Z`);

  if (!days.has(today)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(cursor.toISOString().slice(0, 10))) return { current: 0, aliveToday: false };
  }

  let count = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    count += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { current: count, aliveToday: days.has(today) };
}
