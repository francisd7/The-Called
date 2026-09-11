import { test } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import {
  hasTierRoleChange,
  detectTierChange,
  formatTierChangeMessage,
  findClientByDiscordId,
  pickClientChannel,
  registerTierSync,
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
  assert.equal(detectTierChange(['Tier: Momentum'], ['Tier: Momentum', 'Veteran']), null);
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
  assert.match(message, /MOMENTUM/);
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

function makeMember(roleNames, { id = 'member1', displayName = 'Karan Shah' } = {}) {
  return {
    id,
    displayName,
    user: { username: displayName },
    roles: { cache: new Map(roleNames.map((name, i) => [String(i), { name }])) },
    guild: {
      id: 'guild1',
      client: { user: { id: 'bot1' } },
      channels: { cache: new Map() },
      roles: { cache: { find: () => undefined } },
    },
  };
}

function makeHarness({ clientRecord = { id: 'recABC', fields: {} } } = {}) {
  const client = new EventEmitter();
  const sent = [];
  const updates = [];
  const discord = {
    client,
    sendToChannel: async (channelId, message) => sent.push({ channelId, message }),
  };
  const airtableClient = {
    listRecords: async () => (clientRecord ? [clientRecord] : []),
    updateRecord: async (baseId, tableId, recordId, fields) => updates.push({ recordId, fields }),
  };
  registerTierSync({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    tierChangesChannelId: 'opsChan',
    log: { info: () => {}, error: () => {} },
  });
  return { client, sent, updates };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('an upsell writes the exact Airtable option name', async () => {
  const h = makeHarness();
  h.client.emit('guildMemberUpdate', makeMember(['Tier: Foundations']), makeMember(['Tier: Momentum']));
  await settle();

  assert.equal(h.updates.length, 1);
  // Must be the literal select option, parenthetical included — Airtable
  // rejects a value that isn't already an option.
  assert.deepEqual(h.updates[0].fields, { 'Package / Tier': 'Momentum (Mid)' });
  assert.equal(h.sent[0].channelId, 'opsChan');
  assert.match(h.sent[0].message, /Foundations → Momentum/);
});

// Someone finishing the program and becoming a Veteran loses their tier
// role. Blanking Package / Tier there would destroy the record of what they
// actually paid for — the tier is history, not current access.
test('removing a tier role never blanks the package in Airtable', async () => {
  const h = makeHarness();
  h.client.emit('guildMemberUpdate', makeMember(['Tier: Momentum']), makeMember(['Veteran']));
  await settle();

  assert.deepEqual(h.updates, [], 'nothing should be written on a removal');
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].message, /Momentum → no tier/);
  assert.match(h.sent[0].message, /left as-is in Airtable to preserve history/);
});

test('gaining the Veteran role on its own changes nothing at all', async () => {
  const h = makeHarness();
  h.client.emit(
    'guildMemberUpdate',
    makeMember(['Tier: Momentum']),
    makeMember(['Tier: Momentum', 'Veteran'])
  );
  await settle();

  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.sent, []);
});

test('a tier change for someone with no Airtable record is flagged, not silently dropped', async () => {
  const h = makeHarness({ clientRecord: null });
  h.client.emit('guildMemberUpdate', makeMember([]), makeMember(['Tier: Foundations']));
  await settle();

  assert.deepEqual(h.updates, []);
  assert.match(h.sent[0].message, /No Airtable Client record matched/);
});

test('a change in another guild is ignored', async () => {
  const h = makeHarness();
  const other = makeMember(['Tier: Momentum']);
  other.guild.id = 'someOtherGuild';
  h.client.emit('guildMemberUpdate', makeMember(['Tier: Foundations']), other);
  await settle();

  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.sent, []);
});

test('the client-channel lookup works with a real discord.js overwrite manager', () => {
  // PermissionOverwriteManager does NOT forward Collection methods - `.some()`
  // on it is undefined, so calling it throws. This used to do exactly that,
  // which meant the lookup only ever worked in tests, where plain arrays were
  // passed. moveClientChannel catches the throw and logs "Failed to move the
  // private channel", so a client's first upsell would have written the new
  // tier to Airtable and left their channel under the old category.
  const managerShaped = {
    id: 'chan1',
    parentId: 'cat-momentum',
    permissionOverwrites: { cache: new Map([['member1', {}], ['role1', {}]]) },
  };
  assert.equal(pickClientChannel([managerShaped], 'member1', ['cat-momentum'])?.id, 'chan1');
  assert.equal(pickClientChannel([managerShaped], 'nobody', ['cat-momentum']), null);
});

test('the lookup still accepts a plain overwrite array', () => {
  const arrayShaped = {
    id: 'chan1',
    parentId: 'cat-momentum',
    permissionOverwrites: [{ id: 'member1' }],
  };
  assert.equal(pickClientChannel([arrayShaped], 'member1', ['cat-momentum'])?.id, 'chan1');
});

test('a channel with no overwrites at all does not throw', () => {
  assert.equal(pickClientChannel([{ id: 'c', parentId: 'cat-momentum' }], 'm', ['cat-momentum']), null);
});

test('a parentless channel is found, so a flagged join can be fixed by the tier role', () => {
  // Onboarding creates a channel with no parent when it cannot tell which
  // invite was used. Staff then assign the tier role by hand - and without
  // this, that role change updated Airtable and left the channel where it was,
  // with only the CSM on it.
  const channels = [
    { id: 'cat-momentum', parentId: null, permissionOverwrites: [] },
    { id: 'loose', parentId: null, permissionOverwrites: [{ id: 'member1' }] },
  ];
  assert.equal(pickClientChannel(channels, 'member1', ['cat-momentum'])?.id, 'loose');
});

test('a channel already in a tier category wins over a parentless one', () => {
  const channels = [
    { id: 'loose', parentId: null, permissionOverwrites: [{ id: 'member1' }] },
    { id: 'proper', parentId: 'cat-momentum', permissionOverwrites: [{ id: 'member1' }] },
  ];
  assert.equal(pickClientChannel(channels, 'member1', ['cat-momentum'])?.id, 'proper');
});

test('an overwrite on a shared channel is still never mistaken for a private one', () => {
  // The reason the lookup is restricted at all: a client holds overwrites on
  // plenty of channels. Only a tier category or no category counts.
  const channels = [
    { id: 'wins', parentId: 'cat-forge', permissionOverwrites: [{ id: 'member1' }] },
  ];
  assert.equal(pickClientChannel(channels, 'member1', ['cat-momentum']), null);
});
