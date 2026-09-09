import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffInviteUses,
  toUsesMap,
  createInviteTracker,
  RESOLVED,
  NO_CHANGE,
  AMBIGUOUS,
} from '../src/discord/inviteTracker.js';

const silent = { info: () => {}, error: () => {} };

test('the invite whose use count went up is the one that was used', () => {
  const before = new Map([['aaa', 3], ['bbb', 7]]);
  const after = new Map([['aaa', 4], ['bbb', 7]]);
  assert.deepEqual(diffInviteUses(before, after), { code: 'aaa', reason: RESOLVED });
});

test('no movement means the join came from somewhere untracked', () => {
  // A vanity URL or the server widget produces no invite diff at all.
  const before = new Map([['aaa', 3]]);
  assert.deepEqual(diffInviteUses(before, new Map([['aaa', 3]])), {
    code: null,
    reason: NO_CHANGE,
  });
});

// Guessing here would hand someone the wrong tier, so two simultaneous joins
// resolve to nothing and get flagged instead.
test('two invites moving at once is ambiguous, not a coin flip', () => {
  const before = new Map([['aaa', 1], ['bbb', 1]]);
  const after = new Map([['aaa', 2], ['bbb', 2]]);
  assert.deepEqual(diffInviteUses(before, after), { code: null, reason: AMBIGUOUS });
});

test('an invite deleted between snapshots counts as used', () => {
  // Discord deletes a max-uses invite the moment it is consumed, so it
  // disappears rather than incrementing.
  const before = new Map([['aaa', 0], ['bbb', 4]]);
  const after = new Map([['bbb', 4]]);
  assert.deepEqual(diffInviteUses(before, after), { code: 'aaa', reason: RESOLVED });
});

test('a code first seen alongside existing ones counts only if already used', () => {
  const before = new Map([['aaa', 1]]);
  assert.deepEqual(diffInviteUses(before, new Map([['aaa', 1], ['new', 1]])), {
    code: 'new',
    reason: RESOLVED,
  });
  assert.deepEqual(diffInviteUses(before, new Map([['aaa', 1], ['new', 0]])), {
    code: null,
    reason: NO_CHANGE,
  });
});

// Priming from empty must not make every pre-existing invite look used.
test('a first snapshot never treats existing invites as newly used', () => {
  const after = new Map([['aaa', 12], ['bbb', 4]]);
  assert.deepEqual(diffInviteUses(new Map(), after), { code: null, reason: NO_CHANGE });
});

test('toUsesMap defaults a missing use count to zero', () => {
  assert.deepEqual(
    [...toUsesMap([{ code: 'aaa', uses: 3 }, { code: 'bbb' }]).entries()],
    [['aaa', 3], ['bbb', 0]]
  );
});

test('an unprimed tracker flags the join and primes itself for the next one', async () => {
  let invites = [{ code: 'aaa', uses: 1 }];
  const tracker = createInviteTracker({ fetchInvites: async () => invites, log: silent });

  assert.equal(tracker.isPrimed, false);
  assert.deepEqual(await tracker.resolveForJoin(), { code: null, reason: NO_CHANGE });
  assert.equal(tracker.isPrimed, true);

  invites = [{ code: 'aaa', uses: 2 }];
  assert.deepEqual(await tracker.resolveForJoin(), { code: 'aaa', reason: RESOLVED });
});

// Two people joining seconds apart on different links. If the fetches were
// allowed to overlap, both would still be comparing against the snapshot
// taken at prime time, see two codes incremented, and both come back
// AMBIGUOUS. Serialising makes the first join's snapshot the second's
// baseline, so each resolves cleanly.
test('joins are handled one at a time, each baselined on the last snapshot', async () => {
  // What Discord's counters actually read at each fetch: prime, then the
  // fetch for member A (who used aaa), then the one for B (who used bbb).
  const snapshots = [
    [{ code: 'aaa', uses: 0 }, { code: 'bbb', uses: 0 }],
    [{ code: 'aaa', uses: 1 }, { code: 'bbb', uses: 0 }],
    [{ code: 'aaa', uses: 1 }, { code: 'bbb', uses: 1 }],
  ];
  let call = 0;
  let active = 0;
  let maxConcurrent = 0;

  const tracker = createInviteTracker({
    fetchInvites: async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return snapshots[Math.min(call++, snapshots.length - 1)];
    },
    log: silent,
  });

  await tracker.prime();
  const first = tracker.resolveForJoin();
  const second = tracker.resolveForJoin();

  assert.deepEqual(await first, { code: 'aaa', reason: RESOLVED });
  assert.deepEqual(await second, { code: 'bbb', reason: RESOLVED });
  assert.equal(maxConcurrent, 1, 'overlapping fetches would let both read a stale baseline');
});

test('a fetch failure flags the join rather than throwing into the join handler', async () => {
  const tracker = createInviteTracker({
    fetchInvites: async () => [{ code: 'aaa', uses: 1 }],
    log: silent,
  });
  await tracker.prime();

  const failing = createInviteTracker({
    fetchInvites: async () => {
      throw new Error('discord is down');
    },
    log: silent,
  });
  await failing.prime();
  assert.equal(failing.isPrimed, false);
  assert.deepEqual(await failing.resolveForJoin(), { code: null, reason: NO_CHANGE });
});

test('one failed join does not wedge the queue for later joins', async () => {
  let shouldFail = true;
  let uses = 5;
  const tracker = createInviteTracker({
    fetchInvites: async () => {
      if (shouldFail) throw new Error('transient');
      return [{ code: 'aaa', uses }];
    },
    log: silent,
  });

  shouldFail = false;
  await tracker.prime();
  shouldFail = true;
  assert.deepEqual(await tracker.resolveForJoin(), { code: null, reason: NO_CHANGE });

  shouldFail = false;
  uses = 6;
  assert.deepEqual(await tracker.resolveForJoin(), { code: 'aaa', reason: RESOLVED });
});
