import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { paceFor, workingDaysElapsed, workingDaysInMonth } from '../src/lib/pace.ts';

// September 2026: the 1st is a Tuesday, so 22 working days.
const SEP = 8;

test('a month is counted in working days', () => {
  assert.equal(workingDaysInMonth(2026, SEP), 22);
});

test('weekends do not count as elapsed', () => {
  // Sat 5th and Sun 6th add nothing over Fri 4th.
  assert.equal(workingDaysElapsed(2026, SEP, 4), 4);
  assert.equal(workingDaysElapsed(2026, SEP, 6), 4);
  assert.equal(workingDaysElapsed(2026, SEP, 7), 5);
});

test('no target means no bar, rather than a bar against nothing', () => {
  assert.equal(paceFor(10, null, new Date(Date.UTC(2026, SEP, 15))), null);
  assert.equal(paceFor(10, 0, new Date(Date.UTC(2026, SEP, 15))), null);
});

test('half the working month gone, half the target done, is on pace', () => {
  // 11 of 22 working days by Tue 15 September.
  const p = paceFor(50, 100, new Date(Date.UTC(2026, SEP, 15)))!;
  assert.equal(workingDaysElapsed(2026, SEP, 15), 11);
  assert.equal(p.elapsed, 0.5);
  assert.equal(p.expected, 50);
  assert.equal(p.ahead, true, 'exactly on pace counts as keeping up');
});

test('short of where the month says you should be reads as behind', () => {
  const p = paceFor(20, 100, new Date(Date.UTC(2026, SEP, 15)))!;
  assert.equal(p.ahead, false);
  assert.equal(p.done, 0.2);
});

test('the bar never runs past its end', () => {
  const p = paceFor(250, 100, new Date(Date.UTC(2026, SEP, 15)))!;
  assert.equal(p.done, 1);
  assert.equal(p.ahead, true);
});

test('a weekend does not move the goalposts', () => {
  // Friday and the Sunday after it expect the same, because no working time
  // passed in between - otherwise the bar drifts every weekend.
  const fri = paceFor(30, 100, new Date(Date.UTC(2026, SEP, 11)))!;
  const sun = paceFor(30, 100, new Date(Date.UTC(2026, SEP, 13)))!;
  assert.equal(fri.expected, sun.expected);
});

test('nothing done on the first working day is not yet behind', () => {
  const p = paceFor(0, 100, new Date(Date.UTC(2026, SEP, 1)))!;
  assert.ok(p.expected > 0);
  assert.equal(p.ahead, false, 'one day in, zero really is behind');
  assert.equal(p.done, 0);
});
