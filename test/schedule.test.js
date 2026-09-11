import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalTimeParts,
  isTargetMinute,
  getLocalDateString,
  isWeeklyJobDue,
  BUSINESS_TIMEZONE,
} from '../src/reminders/schedule.js';

test('getLocalTimeParts reads weekday/hour/minute in a given timezone', () => {
  // 2026-09-11 is a Friday. 16:00 UTC on that date is 12:00 EDT (America/New_York, DST).
  const date = new Date('2026-09-11T16:00:00Z');
  const parts = getLocalTimeParts(date, 'America/New_York');
  assert.equal(parts.weekday, 'Fri');
  assert.equal(parts.hour, 12);
  assert.equal(parts.minute, 0);
});

test('isTargetMinute matches only the exact configured weekday/hour/minute', () => {
  const fridayNoonEt = new Date('2026-09-11T16:00:00Z');
  const target = { weekday: 'Fri', hour: 12, minute: 0, timeZone: 'America/New_York' };

  assert.equal(isTargetMinute(fridayNoonEt, target), true);
  assert.equal(isTargetMinute(new Date('2026-09-11T16:01:00Z'), target), false);
  assert.equal(isTargetMinute(new Date('2026-09-10T16:00:00Z'), target), false); // Thursday
});

test('isTargetMinute handles the DST boundary correctly (EST vs EDT)', () => {
  // 2026-01-09 is a Friday, in EST (UTC-5) - noon ET is 17:00 UTC, not 16:00.
  const target = { weekday: 'Fri', hour: 12, minute: 0, timeZone: 'America/New_York' };
  assert.equal(isTargetMinute(new Date('2026-01-09T17:00:00Z'), target), true);
  assert.equal(isTargetMinute(new Date('2026-01-09T16:00:00Z'), target), false);
});

test('getLocalDateString returns YYYY-MM-DD in the given timezone', () => {
  // 2026-09-12T03:30:00Z is still 2026-09-11 (11:30pm) in America/New_York.
  assert.equal(getLocalDateString(new Date('2026-09-12T03:30:00Z'), 'America/New_York'), '2026-09-11');
});

test('a calendar date in the business timezone does not roll over at 8pm local', () => {
  // The bug this exists to stop: Start Date was formatted with toISOString(),
  // which is UTC and rolls over at 8pm Eastern - prime signup hours. A client
  // who joined at 8:04pm was stamped with the next day's date and then read as
  // "hasn't started yet" for a day.
  const eveningSignup = new Date('2026-09-11T00:04:19.000Z'); // 8:04pm Sep 10 ET
  assert.equal(eveningSignup.toISOString().slice(0, 10), '2026-09-11');
  assert.equal(getLocalDateString(eveningSignup, BUSINESS_TIMEZONE), '2026-09-10');
});

test('the business timezone tracks DST rather than a fixed offset', () => {
  // Same wall-clock hour, six months apart: EDT in September, EST in January.
  assert.equal(getLocalDateString(new Date('2026-09-11T03:30:00.000Z'), BUSINESS_TIMEZONE), '2026-09-10');
  assert.equal(getLocalDateString(new Date('2026-01-11T03:30:00.000Z'), BUSINESS_TIMEZONE), '2026-01-10');
});

// The bug this replaces: isTargetMinute needs a tick to land inside the exact
// 60-second target minute, and the checker runs on setInterval(60_000), which
// never fires early and accumulates lateness. Two ticks 60.1s apart at
// 11:59:59.9 and 12:01:00.0 skip the 12:00 minute entirely, and the job
// silently does not run for a week.
const FRIDAY_NOON = { weekday: 'Fri', hour: 12, minute: 0, timeZone: BUSINESS_TIMEZONE };
const noonFriday = new Date('2026-09-11T16:00:00.000Z'); // 12:00 EDT

test('a weekly job is due from its target time onward, not only on the minute', () => {
  assert.equal(isWeeklyJobDue(noonFriday, FRIDAY_NOON), true);
  // The exact minute was missed by a drifting tick; a minute later it still runs.
  assert.equal(isWeeklyJobDue(new Date('2026-09-11T16:01:00.000Z'), FRIDAY_NOON), true);
  // And hours later, after a restart that spanned the window.
  assert.equal(isWeeklyJobDue(new Date('2026-09-11T19:30:00.000Z'), FRIDAY_NOON), true);
});

test('it is not due before its time', () => {
  assert.equal(isWeeklyJobDue(new Date('2026-09-11T15:59:00.000Z'), FRIDAY_NOON), false);
});

test('it is not due on the wrong weekday, however late in the day', () => {
  assert.equal(isWeeklyJobDue(new Date('2026-09-10T23:00:00.000Z'), FRIDAY_NOON), false);
});

test('having already run today stops it firing again', () => {
  // The caller stamps the local date before sending, so every later tick that
  // day sees the stamp. This is what makes catching up safe.
  assert.equal(isWeeklyJobDue(noonFriday, { ...FRIDAY_NOON, lastRunDate: '2026-09-11' }), false);
  // Last week's stamp does not stop this week's run.
  assert.equal(isWeeklyJobDue(noonFriday, { ...FRIDAY_NOON, lastRunDate: '2026-09-04' }), true);
});

test('the target time is read in Eastern, not UTC', () => {
  // 16:00 UTC is noon EDT and due; 12:00 UTC is 8am EDT and is not.
  assert.equal(isWeeklyJobDue(new Date('2026-09-11T12:00:00.000Z'), FRIDAY_NOON), false);
});
