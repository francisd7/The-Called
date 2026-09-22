import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { planBulkAssign, type Assignable } from '../src/lib/assignRules.ts';

const LOUI = 'user-loui';
const ALEXIS = 'user-alexis';
const FRANCIS = 'user-francis';

const ROLES = new Map([
  [LOUI, 'setter'],
  [ALEXIS, 'setter'],
  [FRANCIS, 'admin'],
]);

const rows = (...setters: (string | null)[]): Assignable[] =>
  setters.map((setterId, i) => ({ id: `lead-${i}`, setterId }));

test('a lead nobody owns moves', () => {
  const plan = planBulkAssign(rows(null, null), LOUI, ROLES);
  assert.deepEqual(plan.moved, ['lead-0', 'lead-1']);
  assert.equal(plan.leftAlone, 0);
});

test('a lead a setter is working is never taken off them', () => {
  // The whole reason this is a named function. Selecting a filtered page and
  // pressing Assign must not quietly hand somebody else's live conversation
  // to a colleague.
  const plan = planBulkAssign(rows(ALEXIS), LOUI, ROLES);
  assert.deepEqual(plan.moved, []);
  assert.equal(plan.leftAlone, 1);
});

test('a lead parked with an admin is the backlog, and moves', () => {
  // 432 rows came out of the tracker owned by nobody and were handed to
  // whoever ran the import. That is a pile to be dealt out, not somebody's
  // work in progress.
  const plan = planBulkAssign(rows(FRANCIS), LOUI, ROLES);
  assert.deepEqual(plan.moved, ['lead-0']);
  assert.equal(plan.leftAlone, 0);
});

test('a lead already theirs is counted, not rewritten', () => {
  const plan = planBulkAssign(rows(LOUI, LOUI), LOUI, ROLES);
  assert.deepEqual(plan.moved, []);
  assert.equal(plan.alreadyTheirs, 2);
});

test('a mixed selection sorts itself out', () => {
  const plan = planBulkAssign(rows(null, ALEXIS, LOUI, FRANCIS, null), LOUI, ROLES);
  assert.deepEqual(plan.moved, ['lead-0', 'lead-3', 'lead-4']);
  assert.equal(plan.leftAlone, 1, 'Alexis kept hers');
  assert.equal(plan.alreadyTheirs, 1);
});

test('a setter who has left the team is not protected forever', () => {
  // Somebody whose row is gone has no role, so their leads are dealt out
  // again rather than being stuck to a person who is no longer here.
  const plan = planBulkAssign(rows('user-departed'), LOUI, ROLES);
  assert.deepEqual(plan.moved, ['lead-0']);
});
