import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTierRoleChange,
  detectTierChange,
  formatTierChangeMessage,
  findClientByDiscordId,
  pickClientChannel,
  UPSELL,
  DOWNGRADE,
  ASSIGNED,
  REMOVED,
} from '../src/discord/tierSync.js';

test('a change to non-tier roles is not a tier change', () => {
  assert.equal(
    hasTierRoleChange(['Tier: Momentum'], ['Tier: Momentum', 'First Client Closed']),
    false
  );
  assert.equal(detectTierChange(['Tier: Momentum'], ['Tier: Momentum', 'Alumni']), null);
});

test('moving up the ladder reads as an upsell', () => {
  const change = detectTierChange(['Tier: Foundations'], ['Tier: Momentum']);
  assert.equal(change.direction, UPSELL);
  assert.equal(change.from.name, 'Foundations');
  assert.equal(change.to.name, 'Momentum');
});

test('moving down the ladder reads as a downgrade', () => {
  assert.equal(
    detectTierChange(['Tier: Inner Circle'], ['Tier: Foundations']).direction,
    DOWNGRADE
  );
});

test('a first tier is an assignment; losing the tier is a removal', () => {
  const assigned = detectTierChange(['Called Coaches'], ['Called Coaches', 'Tier: Foundations']);
  assert.equal(assigned.direction, ASSIGNED);
  assert.equal(assigned.from, null);

  const removed = detectTierChange(['Tier: Foundations'], []);
  assert.equal(removed.direction, REMOVED);
  assert.equal(removed.to, null);
});

// Adding the new role before removing the old one is how an upsell is
// normally clicked; that intermediate state must not log a spurious change.
test('holding the old and new role at once resolves to the higher one', () => {
  const change = detectTierChange(
    ['Tier: Foundations'],
    ['Tier: Foundations', 'Tier: Inner Circle']
  );
  assert.equal(change.direction, UPSELL);
  assert.equal(change.to.name, 'Inner Circle');

  // ...and clearing the stale role afterwards is then a no-op.
  assert.equal(
    detectTierChange(['Tier: Foundations', 'Tier: Inner Circle'], ['Tier: Inner Circle']),
    null
  );
});

test('the audit line names the person, the move, and where the channel went', () => {
  const change = detectTierChange(['Tier: Foundations'], ['Tier: Momentum']);
  const message = formatTierChangeMessage({
    memberId: '123',
    displayName: 'Karan Shah',
    change,
    channelId: '456',
  });
  assert.match(message, /Karan Shah/);
  assert.match(message, /<@123>/);
  assert.match(message, /Foundations → Momentum/);
  assert.match(message, /<#456>/);
  assert.match(message, /CLIENTS · MOMENTUM/);
  assert.equal(message.includes('⚠️'), false);
});

test('a warning is surfaced in the audit line, not swallowed', () => {
  const change = detectTierChange([], ['Tier: Momentum']);
  const message = formatTierChangeMessage({
    memberId: '123',
    displayName: 'Karan Shah',
    change,
    channelId: null,
    warning: 'No Airtable Client record matched this Discord ID.',
  });
  assert.match(message, /⚠️ No Airtable Client record matched/);
  assert.equal(message.includes('<#'), false);
});

test('findClientByDiscordId matches on the trimmed Discord ID', async () => {
  let captured;
  const airtableClient = {
    listRecords: async (baseId, tableId, { filterByFormula }) => {
      captured = filterByFormula;
      return [{ id: 'recABC' }];
    },
  };
  const result = await findClientByDiscordId(airtableClient, 'appXXX', '123456');
  assert.equal(result.id, 'recABC');
  assert.equal(captured, "TRIM({Discord ID}) = '123456'");
});

test('findClientByDiscordId returns null when nothing matches', async () => {
  const airtableClient = { listRecords: async () => [] };
  assert.equal(await findClientByDiscordId(airtableClient, 'appXXX', '999'), null);
});

// Matching on the member's overwrite rather than the channel name means a
// client who changes their Discord display name keeps their channel.
test('the client channel is found by their overwrite inside a tier category', () => {
  const channels = [
    { id: 'c1', parentId: 'catFoundations', permissionOverwrites: [{ id: 'member1' }] },
    { id: 'c2', parentId: 'catMomentum', permissionOverwrites: [{ id: 'member2' }] },
  ];
  assert.equal(pickClientChannel(channels, 'member2', ['catFoundations', 'catMomentum']).id, 'c2');
});

test('an overwrite on a shared channel is not mistaken for a private one', () => {
  const channels = [
    { id: 'shared', parentId: 'catStaff', permissionOverwrites: [{ id: 'member1' }] },
  ];
  assert.equal(pickClientChannel(channels, 'member1', ['catFoundations']), null);
});

test('pickClientChannel copes with channels that have no overwrites', () => {
  const channels = [{ id: 'c1', parentId: 'catFoundations' }];
  assert.equal(pickClientChannel(channels, 'member1', ['catFoundations']), null);
});
