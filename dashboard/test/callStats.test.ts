import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summariseCalls, type CallRow } from '../src/lib/callStats.ts';

const call = (over: Partial<CallRow> = {}): CallRow => ({
  cancelled: false, showed: true, closed: false, settled: true,
  cashCollected: null, contractValue: null, ...over,
});

test('nothing booked is not a zero percent show rate', () => {
  const s = summariseCalls([]);
  assert.equal(s.booked, 0);
  assert.equal(s.showRate, null);
  assert.equal(s.closeRate, null);
});

test('the basics add up', () => {
  const s = summariseCalls([
    call({ closed: true, cashCollected: '5000' }),
    call(),
    call({ showed: false }),
    call({ cancelled: true, showed: null, settled: false }),
  ]);
  assert.equal(s.booked, 4);
  assert.equal(s.cancelled, 1);
  assert.equal(s.held, 3);
  assert.equal(s.showed, 2);
  assert.equal(s.noShowed, 1);
  assert.equal(s.closed, 1);
  assert.equal(s.cash, 5000);
});

test('a call still waiting on its outcome is unknown, not a no-show', () => {
  // Counting it as one makes every week look worse than it was until the
  // paperwork catches up, which is exactly when somebody looks at the page.
  const s = summariseCalls([call(), call({ showed: null, settled: false })]);
  assert.equal(s.settled, 1);
  assert.equal(s.showed, 1);
  assert.equal(s.noShowed, 0);
  assert.equal(s.showRate, 1, 'one of one recorded turned up');
});

test('a cancelled call is not a no-show either', () => {
  const s = summariseCalls([call({ cancelled: true, showed: null, settled: false })]);
  assert.equal(s.held, 0);
  assert.equal(s.noShowed, 0);
  assert.equal(s.showRate, null);
  assert.equal(s.cancelRate, 1);
});

test('close rate is of the people who turned up', () => {
  // Over everything booked it would punish a week of cancellations twice.
  const s = summariseCalls([
    call({ closed: true }),
    call(),
    call({ showed: false }),
    call({ cancelled: true, showed: null, settled: false }),
  ]);
  assert.equal(s.showed, 2);
  assert.equal(s.closeRate, 0.5);
});

test('cancelled calls carry no money into the totals', () => {
  const s = summariseCalls([
    call({ closed: true, cashCollected: '3000', contractValue: '6000' }),
    call({ cancelled: true, settled: false, showed: null, cashCollected: '9999' }),
  ]);
  assert.equal(s.cash, 3000);
  assert.equal(s.contract, 6000);
});

test('cash per show divides by the people who turned up', () => {
  const s = summariseCalls([
    call({ closed: true, cashCollected: '4000' }),
    call(),
  ]);
  assert.equal(s.cashPerShow, 2000);
});

test('money arrives as strings from the database and still adds up', () => {
  const s = summariseCalls([call({ cashCollected: '1500.50' }), call({ cashCollected: '2499.50' })]);
  assert.equal(s.cash, 4000);
});

test('nobody showed means no close rate rather than nought per cent', () => {
  const s = summariseCalls([call({ showed: false }), call({ showed: false })]);
  assert.equal(s.showRate, 0, 'a real zero: both were recorded and neither turned up');
  assert.equal(s.closeRate, null, 'but there is nothing to have closed');
});
