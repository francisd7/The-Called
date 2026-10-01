import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { closerPatch } from '../src/lib/closerAttribution.ts';

const NIGEL = { id: 'nigel', name: 'Nigel' };

test('a lead nobody has spoken for gets the Calendly host', () => {
  assert.deepEqual(closerPatch(null, NIGEL, 'Nigel Daley'), {
    closerId: 'nigel',
    closerName: 'Nigel',
  });
});

test('a closer already on the lead is left alone', () => {
  // The case this exists for. One shared Calendly account means the host is
  // the account owner on every booking, and a reschedule fires the same event
  // again - so a call corrected to the other closer in triage used to revert,
  // and the pre-call brief followed it to the wrong person.
  assert.deepEqual(closerPatch('andrew', NIGEL, 'Nigel Daley'), {});
});

test('an unknown host still names somebody, so the call is not anonymous', () => {
  // No user row matches the host email, but the booking still says who it is
  // with - better on the lead than discarded.
  assert.deepEqual(closerPatch(null, null, 'Nigel Daley'), {
    closerId: null,
    closerName: 'Nigel Daley',
  });
});

test('an unknown host with no name leaves both empty rather than guessing', () => {
  assert.deepEqual(closerPatch(null, null, null), { closerId: null, closerName: null });
});

test('an existing closer wins even when Calendly knows nobody', () => {
  assert.deepEqual(closerPatch('andrew', null, null), {});
});
