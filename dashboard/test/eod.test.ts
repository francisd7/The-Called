import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summariseEodWeek, emptyEodTotals } from '../src/lib/eodMath.ts';
import { shiftDateString, weekDays } from '../src/lib/dates.ts';

const PEOPLE = [
  { id: 'loui', name: 'Loui', color: null },
  { id: 'alexis', name: 'Alexis', color: null },
];
const DAYS = weekDays('2026-09-14');

test('a week runs Monday to Sunday and shifts by whole days', () => {
  assert.equal(DAYS.length, 7);
  assert.equal(DAYS[0], '2026-09-14');
  assert.equal(DAYS[6], '2026-09-20');
  assert.equal(shiftDateString('2026-09-14', -7), '2026-09-07');
  // Across a month boundary, and across the daylight-saving change.
  assert.equal(shiftDateString('2026-08-31', 1), '2026-09-01');
  assert.equal(shiftDateString('2026-11-01', -1), '2026-10-31');
});

test('a setter who filed nothing is a row of blanks, not a missing row', () => {
  const { people } = summariseEodWeek({
    people: PEOPLE,
    rows: [{ userId: 'loui', reportDate: '2026-09-15', totalOutbounds: 40 }],
    days: DAYS,
  });

  assert.equal(people.length, 2, 'both setters should appear whether or not they filed');
  const alexis = people.find((p) => p.id === 'alexis');
  assert.equal(alexis?.filed, 0);
  assert.equal(alexis?.totals.totalOutbounds, 0);
});

test('totals add up per setter and for the team', () => {
  const { people, team } = summariseEodWeek({
    people: PEOPLE,
    rows: [
      { userId: 'loui', reportDate: '2026-09-14', totalOutbounds: 40, callsBooked: 1 },
      { userId: 'loui', reportDate: '2026-09-15', totalOutbounds: 35, callsBooked: 2 },
      { userId: 'alexis', reportDate: '2026-09-15', totalOutbounds: 50, callsBooked: 1 },
    ],
    days: DAYS,
  });

  const loui = people.find((p) => p.id === 'loui')!;
  assert.equal(loui.filed, 2);
  assert.equal(loui.totals.totalOutbounds, 75);
  assert.equal(loui.totals.callsBooked, 3);
  assert.equal(team.totalOutbounds, 125);
  assert.equal(team.callsBooked, 4);
});

test('money arrives from Postgres as a string and still adds up', () => {
  const { team } = summariseEodWeek({
    people: PEOPLE,
    rows: [
      { userId: 'loui', reportDate: '2026-09-14', cashCollected: '2500.00' },
      { userId: 'alexis', reportDate: '2026-09-16', cashCollected: '1500.50' },
    ],
    days: DAYS,
  });
  assert.equal(team.cashCollected, 4000.5);
});

test('a report from another week is not counted in this one', () => {
  const { people, team } = summariseEodWeek({
    people: PEOPLE,
    rows: [
      { userId: 'loui', reportDate: '2026-09-15', totalOutbounds: 40 },
      { userId: 'loui', reportDate: '2026-09-08', totalOutbounds: 999 },
    ],
    days: DAYS,
  });
  assert.equal(people.find((p) => p.id === 'loui')?.filed, 1);
  assert.equal(team.totalOutbounds, 40);
});

test('a day is indexed by its own date, so the grid lines up', () => {
  const { people } = summariseEodWeek({
    people: PEOPLE,
    rows: [{ userId: 'alexis', reportDate: '2026-09-17', totalOutbounds: 12 }],
    days: DAYS,
  });
  const alexis = people.find((p) => p.id === 'alexis')!;
  assert.equal(alexis.byDay.has('2026-09-17'), true);
  assert.equal(alexis.byDay.has('2026-09-16'), false);
});

test('an empty week totals zero rather than NaN', () => {
  const totals = emptyEodTotals();
  for (const v of Object.values(totals)) assert.equal(v, 0);
});
