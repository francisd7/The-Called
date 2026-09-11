import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalTimeParts,
  isTargetMinute,
  getLocalDateString,
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
