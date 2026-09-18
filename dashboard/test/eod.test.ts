import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summariseEodWeek, emptyEodTotals } from '../src/lib/eodMath.ts';
import { shiftDateString, weekDays } from '../src/lib/dates.ts';
import { buildEodSeries, eodBuckets } from '../src/lib/eodCharts.ts';
import { niceStep } from '../src/lib/chartScale.ts';

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

// --- charts -----------------------------------------------------------------

test('a day nobody filed is a gap, not a zero', () => {
  const buckets = eodBuckets('day', 4, '2026-09-17');
  assert.deepEqual(buckets, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);

  const [loui] = buildEodSeries({
    people: [PEOPLE[0]],
    rows: [
      { userId: 'loui', reportDate: '2026-09-14', totalOutbounds: 30 },
      { userId: 'loui', reportDate: '2026-09-16', totalOutbounds: 0 },
    ],
    buckets,
    bucket: 'day',
    metric: 'totalOutbounds',
  });

  assert.equal(loui.points[0].y, 30);
  assert.equal(loui.points[1].y, null, "a day with no report isn't a day of no work");
  assert.equal(loui.points[2].y, 0, 'a report of zero is a real zero');
  assert.equal(loui.points[3].y, null);
});

test('weekly buckets land on Mondays and sum the week', () => {
  const buckets = eodBuckets('week', 3, '2026-09-17');
  assert.deepEqual(buckets, ['2026-08-31', '2026-09-07', '2026-09-14']);

  const [loui] = buildEodSeries({
    people: [PEOPLE[0]],
    rows: [
      { userId: 'loui', reportDate: '2026-09-14', callsBooked: 1 },
      { userId: 'loui', reportDate: '2026-09-16', callsBooked: 2 },
      { userId: 'loui', reportDate: '2026-09-08', callsBooked: 1 },
    ],
    buckets,
    bucket: 'week',
    metric: 'callsBooked',
  });

  assert.equal(loui.points[0].y, null, 'no reports that week');
  assert.equal(loui.points[1].y, 1);
  assert.equal(loui.points[2].y, 3, 'both reports in the week should add up');
});

test('money comes back as a number a chart can plot', () => {
  const [loui] = buildEodSeries({
    people: [PEOPLE[0]],
    rows: [{ userId: 'loui', reportDate: '2026-09-14', cashCollected: '1200.00' }],
    buckets: eodBuckets('day', 1, '2026-09-14'),
    bucket: 'day',
    metric: 'cashCollected',
  });
  assert.equal(loui.points[0].y, 1200);
});

test('every setter gets a series, filed or not', () => {
  const series = buildEodSeries({
    people: PEOPLE,
    rows: [{ userId: 'loui', reportDate: '2026-09-14', totalOutbounds: 30 }],
    buckets: eodBuckets('day', 2, '2026-09-15'),
    bucket: 'day',
    metric: 'totalOutbounds',
  });
  assert.equal(series.length, 2);
  assert.deepEqual(
    series.find((s) => s.key === 'alexis')?.points.map((p) => p.y),
    [null, null]
  );
});

test('gridline steps are numbers a person would write down', () => {
  // 45 outbounds used to give an axis stepping by 13, from rounding 12.5.
  assert.equal(niceStep(45), 15);
  assert.equal(niceStep(75), 20);
  assert.equal(niceStep(220), 60, 'a 300-high axis for 220 of data is mostly air');
  assert.equal(niceStep(3), 1, 'a count never steps by a fraction');
  assert.equal(niceStep(1), 1);
  assert.equal(niceStep(0), 1, 'an empty chart still needs an axis');
  assert.equal(niceStep(5000, 'usd'), 1250);
});

test('a count axis is always whole numbers, and always covers the data', () => {
  for (let max = 1; max <= 500; max += 1) {
    const step = niceStep(max);
    assert.ok(Number.isInteger(step), `${max} produced a fractional step ${step}`);
    assert.ok(step * 4 >= max, `${max} did not fit under its own axis`);
    // Four steps of headroom is fine; ten is an axis of mostly air.
    assert.ok(step * 4 <= Math.max(4, max * 2), `${max} got an axis to ${step * 4}`);
  }
});

test('a money axis covers the data too', () => {
  for (const max of [100, 1200, 5000, 13000, 48000]) {
    assert.ok(niceStep(max, 'usd') * 4 >= max, `${max} did not fit`);
  }
});
