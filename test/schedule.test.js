import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalTimeParts, isTargetMinute, getLocalDateString } from '../src/reminders/schedule.js';

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
