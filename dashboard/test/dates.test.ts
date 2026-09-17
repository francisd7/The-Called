import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { teamDateString, teamDayRange } from '../src/lib/dates.ts';

test('a team-local day is 24h long on both sides of the DST switch', () => {
  // Spring forward and fall back are where a hardcoded UTC offset would put
  // "today" on the wrong calendar day for an hour.
  const { start, end } = teamDayRange(0);
  assert.equal(end.getTime() - start.getTime(), 86_400_000);
});

test('the day range brackets the current moment', () => {
  const { start, end } = teamDayRange(0);
  const now = Date.now();
  assert.ok(start.getTime() <= now, 'start is not after now');
  assert.ok(end.getTime() > now, 'end is not after now');
});

test('the day range starts at midnight in the team timezone', () => {
  const { start } = teamDayRange(0);
  const asLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(start);
  assert.match(asLocal, /^(00|24):00$/);
});

test('an evening ET moment still reports the ET calendar day, not the UTC one', () => {
  // 01:30 UTC on the 5th is 21:30 ET on the 4th - a naive toISOString would
  // report the wrong day and put an evening call into tomorrow's list.
  assert.equal(teamDateString(new Date('2026-03-05T01:30:00Z')), '2026-03-04');
  assert.equal(teamDateString(new Date('2026-07-05T01:30:00Z')), '2026-07-04');
});
