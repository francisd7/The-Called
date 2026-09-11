import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planTierReconciliation,
  formatReconciliation,
  NO_TIER_ROLE,
  NO_TIER_ANYWHERE,
  NOT_IN_DISCORD,
  NOT_A_CLIENT,
} from '../src/discord/tierReconcile.js';

function member(id, displayName, roleNames = [], extra = {}) {
  return { id, displayName, roleNames, bot: false, ...extra };
}

function clientsMap(entries) {
  return new Map(entries.map(([id, name, tier]) => [id, { 'Client Name': name, 'Package / Tier': tier }]));
}

test('a Discord tier ahead of Airtable produces a write', () => {
  // The 2026-09-10 case: the role was clicked while the bot was redeploying,
  // so tierSync never saw the event and Airtable kept the old value.
  const plan = planTierReconciliation({
    members: [member('m1', 'Karan Shah', ['Tier: Momentum'])],
    clients: clientsMap([['m1', 'Karan Shah', { name: 'Foundations (Entry)' }]]),
    recordIdByDiscordId: new Map([['m1', 'rec1']]),
  });
  assert.equal(plan.writes.length, 1);
  assert.deepEqual(plan.writes[0], {
    discordId: 'm1',
    clientName: 'Karan Shah',
    recordId: 'rec1',
    from: 'Foundations',
    to: 'Momentum',
    airtableValue: 'Momentum (Mid)',
    needsChannelMove: true,
  });
});

test('an empty Package / Tier is filled from the Discord role', () => {
  const plan = planTierReconciliation({
    members: [member('m1', 'Gavin', ['Tier: Foundations'])],
    clients: clientsMap([['m1', 'Gavin', null]]),
    recordIdByDiscordId: new Map([['m1', 'rec1']]),
  });
  assert.equal(plan.writes[0].from, null);
  assert.equal(plan.writes[0].to, 'Foundations');
});

test('agreement is reported as in sync, not written again', () => {
  const plan = planTierReconciliation({
    members: [member('m1', 'A', ['Tier: Momentum'])],
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
  });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.matched.length, 1);
});

test('the bible-study tier is not marked as needing a channel move', () => {
  const plan = planTierReconciliation({
    members: [member('m1', 'A', ['Tier: The Called'])],
    clients: clientsMap([['m1', 'A', null]]),
  });
  assert.equal(plan.writes[0].needsChannelMove, false);
});

test('no tier role never blanks an existing Package / Tier', () => {
  // Losing the role means losing access, not un-buying the program. Erasing
  // the tier would destroy the record of what they paid for - the same rule
  // tierSync follows on a removal.
  const plan = planTierReconciliation({
    members: [member('m1', 'A', ['Called Coaches'])],
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
  });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.problems[0].kind, NO_TIER_ROLE);
  assert.equal(plan.problems[0].airtableTier, 'Momentum');
});

test('no tier in either place is reported separately', () => {
  // Gavin's state after joining on an unmapped invite: a record exists, but
  // nothing ever resolved what he bought.
  const plan = planTierReconciliation({
    members: [member('m1', 'Gavin', [])],
    clients: clientsMap([['m1', 'Gavin', null]]),
  });
  assert.equal(plan.problems[0].kind, NO_TIER_ANYWHERE);
});

test('an active client missing from the server is flagged, not written', () => {
  const plan = planTierReconciliation({
    members: [],
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
  });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.problems[0].kind, NOT_IN_DISCORD);
});

test('a tier role held by someone who is not an active client is flagged', () => {
  // A veteran who kept their tier role still reaches the paid areas, and
  // nothing else in the system would ever mention it.
  const plan = planTierReconciliation({
    members: [member('m9', 'Old Client', ['Tier: Momentum', 'Veteran'])],
    clients: new Map(),
  });
  assert.equal(plan.problems[0].kind, NOT_A_CLIENT);
  assert.match(plan.problems[0].detail, /Tier: Momentum/);
});

test('staff and bots are never flagged for holding or lacking a tier', () => {
  const plan = planTierReconciliation({
    members: [
      member('s1', 'Francis', ['COO', 'Tier: Inner Circle']),
      member('b1', 'The Called Bot', [], { bot: true }),
      member('m2', 'Plain Member', ['Veteran']),
    ],
    clients: new Map(),
  });
  assert.equal(plan.problems.length, 0);
});

test('the summary names what changed and warns about channels', () => {
  const plan = planTierReconciliation({
    members: [member('m1', 'Karan Shah', ['Tier: Momentum'])],
    clients: clientsMap([['m1', 'Karan Shah', { name: 'Foundations (Entry)' }]]),
  });
  const text = formatReconciliation(plan);
  assert.match(text, /Karan Shah\s+Foundations -> Momentum/);
  assert.match(text, /channel may also need moving/);
});
