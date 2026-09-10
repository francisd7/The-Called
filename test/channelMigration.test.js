import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planClientChannelMoves,
  planRetiredSync,
  formatChannelPlan,
  NO_TIER,
  NO_CHANNEL,
  AMBIGUOUS,
  NO_CATEGORY,
  MISSING_ROLE,
  UNEXPECTED_CHANNEL,
} from '../src/discord/channelMigration.js';

const GUILD = 'guild1';
const BOT = 'bot1';

const ROLE_IDS = new Map([
  ['CSM', 'r-csm'],
  ['CMO', 'r-cmo'],
  ['Nigel', 'r-nigel'],
  ['COO', 'r-coo'],
]);

const CATEGORY_IDS = new Map([
  ['FOUNDATIONS', 'cat-foundations'],
  ['MOMENTUM', 'cat-momentum'],
  ['INNER CIRCLE', 'cat-inner'],
]);

function channel(id, name, { parentId = null, overwrites = [], isText = true } = {}) {
  return { id, name, parentId, isText, overwrites };
}

function member(id) {
  return { id, type: 'member' };
}

function role(id) {
  return { id, type: 'role' };
}

function clientsMap(entries) {
  return new Map(entries.map(([id, name, tier]) => [id, { 'Client Name': name, 'Package / Tier': tier }]));
}

function plan(overrides = {}) {
  return planClientChannelMoves({
    clients: new Map(),
    channels: [],
    declaredChannelIds: new Set(),
    categoryIdByName: CATEGORY_IDS,
    roleIdByName: ROLE_IDS,
    guildId: GUILD,
    botUserId: BOT,
    ...overrides,
  });
}

test('a client channel is matched by the member overwrite and routed to their tier', () => {
  const result = plan({
    clients: clientsMap([['m1', 'Karan Shah', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'karan-shah', { overwrites: [member('m1'), role(GUILD)] })],
  });

  assert.equal(result.moves.length, 1);
  const move = result.moves[0];
  assert.equal(move.channelId, 'c1');
  assert.equal(move.toCategoryName, 'MOMENTUM');
  assert.equal(move.toCategoryId, 'cat-momentum');
  assert.equal(move.parentAlreadyCorrect, false);
  // Momentum is the tier Andrew and Nigel service - the whole reason the
  // overwrites get rewritten rather than the channel just re-parented.
  assert.deepEqual(move.staffRoleIds, ['r-csm', 'r-cmo', 'r-nigel', 'r-coo']);
  assert.deepEqual(move.desiredIds, [GUILD, 'm1', BOT, 'r-csm', 'r-cmo', 'r-nigel', 'r-coo']);
});

test('Foundations deliberately leaves the CMO and Nigel out', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Foundations (Entry)' }]]),
    channels: [channel('c1', 'a', { overwrites: [member('m1')] })],
  });
  assert.deepEqual(result.moves[0].staffRoleNames, ['CSM', 'COO']);
  assert.deepEqual(result.moves[0].staffRoleIds, ['r-csm', 'r-coo']);
});

test('a matched client already in the right category is flagged as such, not dropped', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'a', { parentId: 'cat-momentum', overwrites: [member('m1')] })],
  });
  assert.equal(result.moves.length, 1);
  assert.equal(result.moves[0].parentAlreadyCorrect, true);
});

test('declared structure channels are never candidates', () => {
  // A grant on #wins must not be mistaken for a private channel - matching it
  // would rewrite a shared channel's permissions down to one client.
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'wins', { parentId: 'cat-forge', overwrites: [member('m1')] })],
    declaredChannelIds: new Set(['c1']),
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, NO_CHANNEL);
});

test('several candidates with no name match flag rather than guess', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'a-old', { overwrites: [member('m1')] }),
      channel('c2', 'a-older', { overwrites: [member('m1')] }),
    ],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, AMBIGUOUS);
  // Claimed, so they don't also show up as unclaimed leftovers.
  assert.equal(result.unclaimed.length, 0);
});

test('a personal grant on a retired pod channel is narrowed away by name', () => {
  // The live shape: seven clients hold a grant on a dead pod channel and on
  // #links as well as on their own, and the overwrite test alone can't tell
  // them apart.
  const result = plan({
    clients: clientsMap([['m1', 'Luke Buscher', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'luke-buscher', { overwrites: [member('m1')] }),
      channel('c2', 'pod-2-chat', { overwrites: [member('m1')] }),
      channel('c3', 'links', { overwrites: [member('m1')] }),
    ],
  });
  assert.equal(result.moves.length, 1);
  assert.equal(result.moves[0].channelId, 'c1');
  assert.equal(result.moves[0].narrowedByName, true);
  // The pod and links channels are not theirs, so they stay untouched and
  // surface as leftovers rather than being quietly claimed.
  assert.deepEqual(result.unclaimed.map((channel) => channel.id), ['c2', 'c3']);
});

test('two channels both named after the client stay ambiguous', () => {
  const result = plan({
    clients: clientsMap([['m1', 'Gabe Gois', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'gabe-gois', { overwrites: [member('m1')] }),
      channel('c2', 'Gabe Gois', { overwrites: [member('m1')] }),
    ],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, AMBIGUOUS);
});

test('a single candidate is never narrowed, even when the name does not match', () => {
  // Display names go stale - "Will Pelayo" owns "#william-pelayo". The name is
  // only ever a tiebreaker, never a requirement.
  const result = plan({
    clients: clientsMap([['m1', 'Will Pelayo', { name: 'Foundations (Entry)' }]]),
    channels: [channel('c1', 'william-pelayo', { overwrites: [member('m1')] })],
  });
  assert.equal(result.moves.length, 1);
  assert.equal(result.moves[0].channelId, 'c1');
  assert.equal(result.moves[0].narrowedByName, false);
});

test('bible-study clients with no channel are reported, not silently absent', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'The Called (Bible Study & Warrior Huddles)' }]]),
    channels: [],
  });
  assert.equal(result.problems.length, 0);
  assert.deepEqual(result.noChannelByDesign.map((entry) => entry.clientName), ['A']);
  assert.match(formatChannelPlan(result), /No private channel by design \(1\): A/);
});

test('a client with no recognizable tier is flagged and their channel left alone', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', null]]),
    channels: [channel('c1', 'a', { overwrites: [member('m1')] })],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, NO_TIER);
});

test('The Called gets no private channel, and one existing is reported not deleted', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'The Called (Bible Study & Warrior Huddles)' }]]),
    channels: [channel('c1', 'a', { overwrites: [member('m1')] })],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, UNEXPECTED_CHANNEL);
  assert.equal(result.unclaimed.length, 0);
});

test('a missing tier category blocks the move instead of dropping the channel somewhere', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Inner Circle (High)' }]]),
    channels: [channel('c1', 'a', { overwrites: [member('m1')] })],
    categoryIdByName: new Map(),
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, NO_CATEGORY);
});

test('a missing staff role blocks the move rather than writing the CMO out of it', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'a', { overwrites: [member('m1')] })],
    roleIdByName: new Map([['CSM', 'r-csm'], ['COO', 'r-coo']]),
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, MISSING_ROLE);
  assert.match(result.problems[0].detail, /CMO, Nigel/);
});

test('overwrites the rewrite would remove are reported', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'a', {
        overwrites: [
          { id: GUILD, type: 'role' },
          member('m1'),
          { id: BOT, type: 'member' },
          { id: 'r-csm', type: 'role' },
          // A staff member granted personally, and a stale role.
          { id: 'noah-user', type: 'member' },
          { id: 'r-pod-2', type: 'role' },
        ],
      }),
    ],
  });
  assert.deepEqual(result.moves[0].droppedOverwrites, [
    { id: 'noah-user', type: 'member' },
    { id: 'r-pod-2', type: 'role' },
  ]);
});

test('undeclared channels with a personal grant that nobody claimed are reported, never moved', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'a', { overwrites: [member('m1')] }),
      channel('c2', 'past-client', { overwrites: [member('gone')] }),
      // No member overwrite at all - a plain leftover channel, not a client's.
      channel('c3', 'random', { overwrites: [role('r-csm')] }),
    ],
  });
  assert.equal(result.moves.length, 1);
  assert.deepEqual(result.unclaimed.map((channel) => channel.id), ['c2']);
});

test('voice channels are never candidates', () => {
  const result = plan({
    clients: clientsMap([['m1', 'A', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'a call', { isText: false, overwrites: [member('m1')] })],
  });
  assert.equal(result.moves.length, 0);
  assert.equal(result.problems[0].kind, NO_CHANNEL);
  assert.equal(result.unclaimed.length, 0);
});

test('the summary names the tier, the client and what would be dropped', () => {
  const result = plan({
    clients: clientsMap([['m1', 'Karan Shah', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'karan-shah', {
        parentId: 'cat-old',
        overwrites: [member('m1'), role('r-stale')],
      }),
    ],
  });
  const text = formatChannelPlan(result, { categoryNameById: new Map([['cat-old', 'CLIENTS']]) });
  assert.match(text, /Momentum \(1\)/);
  assert.match(text, /#karan-shah/);
  assert.match(text, /from CLIENTS/);
  assert.match(text, /drops 1 overwrite/);
  assert.match(text, /1 channel\(s\) to move and re-permission\./);
});

test('a channel whose overwrites already match its category is left alone', () => {
  // Syncing copies the category's list down, so a synced channel still has
  // overwrites. Counting them proves nothing; only comparing does.
  const CATEGORY = [{ id: 'r-admin', type: 'role', allow: '1024', deny: '0' }];
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    categoryOverwrites: CATEGORY,
    clients: new Map(),
    channels: [
      channel('c1', 'old-thing', { parentId: 'cat-retired', overwrites: CATEGORY }),
      channel('c2', 'stale', {
        parentId: 'cat-retired',
        overwrites: [...CATEGORY, { id: 'someone', type: 'member', allow: '1024', deny: '0' }],
      }),
    ],
  });
  assert.deepEqual(plan.alreadySynced.map((entry) => entry.id), ['c1']);
  assert.deepEqual(plan.sync.map((entry) => entry.id), ['c2']);
});

test('a matching id with different bits is not synced', () => {
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    categoryOverwrites: [{ id: 'r-admin', type: 'role', allow: '1024', deny: '0' }],
    clients: new Map(),
    channels: [
      channel('c1', 'loosened', {
        parentId: 'cat-retired',
        overwrites: [{ id: 'r-admin', type: 'role', allow: '3072', deny: '0' }],
      }),
    ],
  });
  assert.equal(plan.alreadySynced.length, 0);
  assert.deepEqual(plan.sync.map((entry) => entry.id), ['c1']);
});

test('retired sync takes dead channels and only those in the category', () => {
  // The live shape: a pod channel grants several active clients, which is
  // precisely why it is still visible. It is safe because each of them has a
  // real channel in a tier category.
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    tierCategoryIds: ['cat-momentum'],
    clients: clientsMap([['m1', 'Luke Buscher', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'pod-2-chat', { parentId: 'cat-retired', overwrites: [member('m1')] }),
      channel('c2', 'links', { parentId: 'cat-retired', overwrites: [role('r-old')] }),
      // Elsewhere in the server - not this script's business.
      channel('c3', 'luke-buscher', { parentId: 'cat-momentum', overwrites: [member('m1')] }),
    ],
  });
  assert.deepEqual(plan.sync.map((entry) => entry.id), ['c1', 'c2']);
  assert.equal(plan.protected.length, 0);
});

test('a live client channel dragged into retired is protected by name', () => {
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    clients: clientsMap([['m1', 'Luke Buscher', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'luke-buscher', { parentId: 'cat-retired', overwrites: [] })],
  });
  assert.equal(plan.sync.length, 0);
  assert.match(plan.protected[0].reason, /named after active client Luke Buscher/);
});

test('a renamed client channel with no home elsewhere is protected', () => {
  // The name guard alone would miss this and the sync would wipe the client's
  // access to their only channel.
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    tierCategoryIds: ['cat-momentum'],
    clients: clientsMap([['m1', 'Luke Buscher', { name: 'Momentum (Mid)' }]]),
    channels: [
      channel('c1', 'old-onboarding-thread', {
        parentId: 'cat-retired',
        overwrites: [member('m1')],
      }),
    ],
  });
  assert.equal(plan.sync.length, 0);
  assert.match(plan.protected[0].reason, /only channel granting active client Luke Buscher/);
});

test('an already-synced client channel is reported, not filed as nothing to do', () => {
  // The worst case: their channel is in the retired category AND already
  // wiped, so they have lost access right now. Silence here would be the
  // script confirming a live problem as fine.
  const CATEGORY = [{ id: 'r-admin', type: 'role', allow: '1024', deny: '0' }];
  const plan = planRetiredSync({
    categoryId: 'cat-retired',
    categoryOverwrites: CATEGORY,
    clients: clientsMap([['m1', 'Luke Buscher', { name: 'Momentum (Mid)' }]]),
    channels: [channel('c1', 'luke-buscher', { parentId: 'cat-retired', overwrites: CATEGORY })],
  });
  assert.equal(plan.alreadySynced.length, 0);
  assert.match(plan.protected[0].reason, /named after active client Luke Buscher/);
});
