import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bandFor, planReassign, type ReassignRow } from '../src/lib/reassignRules.ts';

const FRANCIS = 'francis';
const LOUI = 'loui';
const opts = { fromSetterId: FRANCIS, first: '2026-06-01', last: '2026-08-27', toSetterId: LOUI };

const row = (over: Partial<ReassignRow> = {}): ReassignRow => ({
  id: 'l1', setterId: FRANCIS, createdOn: '2026-07-01', cashCollected: null, ...over,
});

test('the boundaries are inclusive at both ends', () => {
  assert.equal(bandFor('2026-05-31', '2026-06-01', '2026-08-27'), 'before');
  assert.equal(bandFor('2026-06-01', '2026-06-01', '2026-08-27'), 'middle', 'the first day counts');
  assert.equal(bandFor('2026-08-27', '2026-06-01', '2026-08-27'), 'middle', 'the last day counts');
  assert.equal(bandFor('2026-08-28', '2026-06-01', '2026-08-27'), 'after');
});

test('the middle band moves and the rest of the pile does not', () => {
  const plan = planReassign(
    [row({ id: 'a', createdOn: '2026-01-05' }), row({ id: 'b' }), row({ id: 'c', createdOn: '2026-09-10' })],
    opts
  );
  assert.equal(plan.band.before.leads, 1);
  assert.equal(plan.band.middle.leads, 1);
  assert.equal(plan.band.after.leads, 1);
  assert.deepEqual(plan.moves, [{ id: 'b', to: LOUI }, { id: 'c', to: null }]);
});

test('somebody else’s lead is never touched', () => {
  // The rule is about splitting one pile. Alexis keeps hers whatever the date.
  const plan = planReassign([row({ id: 'x', setterId: 'alexis' })], opts);
  assert.equal(plan.moves.length, 0);
  assert.equal(plan.band.middle.leads, 0);
});

test('an unassigned lead is not swept up either', () => {
  const plan = planReassign([row({ id: 'x', setterId: null })], opts);
  assert.equal(plan.moves.length, 0);
});

test('cash is counted per band, because that is the point of the change', () => {
  const plan = planReassign(
    [
      row({ id: 'a', createdOn: '2026-01-05', cashCollected: '1000' }),
      row({ id: 'b', createdOn: '2026-07-01', cashCollected: '5000' }),
      row({ id: 'c', createdOn: '2026-09-01', cashCollected: '2500.50' }),
    ],
    opts
  );
  assert.equal(plan.band.before.cash, 1000);
  assert.equal(plan.band.middle.cash, 5000);
  assert.equal(plan.band.after.cash, 2500.5);
});

test('a lead with no creation date is reported, not guessed at', () => {
  // Putting it in a band would move money on a date nobody recorded.
  const plan = planReassign([row({ id: 'x', createdOn: null })], opts);
  assert.equal(plan.undated, 1);
  assert.equal(plan.moves.length, 0);
});

test('an inverted range puts everything in before or after, and nothing moves to the person', () => {
  // first after last is exactly the case worth catching: the middle band is
  // empty, so nobody would receive anything.
  const plan = planReassign(
    [row({ createdOn: '2026-08-28' }), row({ id: 'b', createdOn: '2026-08-29' })],
    { ...opts, first: '2026-08-30', last: '2026-08-27' }
  );
  assert.equal(plan.band.middle.leads, 0);
  assert.equal(plan.moves.every((m) => m.to === null), true);
});

test('running it twice is not the same as running it once', () => {
  // After the first run the middle band belongs to Loui, so a second run over
  // the same pile finds nothing - which is what makes it safe to re-check.
  const rows = [row({ id: 'b' })];
  const first = planReassign(rows, opts);
  assert.equal(first.moves.length, 1);
  const after = rows.map((r) => ({ ...r, setterId: LOUI }));
  assert.equal(planReassign(after, opts).moves.length, 0);
});

test('the unassigned pile can be the one being split', () => {
  // A blank Setter column in the old tracker imports as nobody, so this is the
  // pile that actually needs splitting - and null has to match null to find it.
  const plan = planReassign(
    [
      row({ id: 'a', setterId: null, createdOn: '2026-05-01', cashCollected: 2000 }),
      row({ id: 'b', setterId: null, createdOn: '2026-07-01', cashCollected: 500 }),
      row({ id: 'c', setterId: null, createdOn: '2026-09-01', cashCollected: 100 }),
    ],
    { ...opts, fromSetterId: null }
  );
  assert.deepEqual(plan.band.before, { leads: 1, cash: 2000 });
  assert.deepEqual(plan.band.middle, { leads: 1, cash: 500 });
  assert.deepEqual(plan.band.after, { leads: 1, cash: 100 });
  assert.deepEqual(plan.moves, [
    { id: 'b', to: LOUI },
    { id: 'c', to: null },
  ]);
});

test('splitting the unassigned pile leaves everybody else alone', () => {
  // Alexis already owns her leads; a split of the blank pile must not sweep
  // them up just because they fall inside the dates.
  const plan = planReassign(
    [
      row({ id: 'a', setterId: 'alexis', createdOn: '2026-07-01', cashCollected: 9000 }),
      row({ id: 'b', setterId: null, createdOn: '2026-07-01' }),
    ],
    { ...opts, fromSetterId: null }
  );
  assert.equal(plan.band.middle.leads, 1);
  assert.equal(plan.band.middle.cash, 0);
  assert.deepEqual(plan.moves, [{ id: 'b', to: LOUI }]);
});
