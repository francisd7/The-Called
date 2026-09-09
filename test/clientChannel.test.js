import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientChannelOverwrites,
  resolveRoleIdsByName,
} from '../src/discord/clientChannel.js';

const GRANT = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];

test('the overwrite set denies @everyone and allows the client, the bot and staff', () => {
  assert.deepEqual(
    buildClientChannelOverwrites({
      guildId: 'guild1',
      memberId: 'member1',
      botUserId: 'bot1',
      staffRoleIds: ['csm1', 'coo1'],
    }),
    [
      { id: 'guild1', deny: ['ViewChannel'] },
      { id: 'member1', allow: GRANT },
      { id: 'bot1', allow: GRANT },
      { id: 'csm1', allow: GRANT },
      { id: 'coo1', allow: GRANT },
    ]
  );
});

// Nigel is both Founder and a CSM, so a tier's staff list can resolve to the
// same role twice — and Discord rejects duplicate overwrite targets.
test('a role listed twice produces one overwrite', () => {
  const overwrites = buildClientChannelOverwrites({
    guildId: 'guild1',
    memberId: 'member1',
    botUserId: 'bot1',
    staffRoleIds: ['csm1', 'csm1', null, undefined],
  });
  assert.equal(overwrites.length, 4);
  assert.deepEqual(overwrites.at(-1), { id: 'csm1', allow: GRANT });
});

test('the set is complete on its own, since a client channel is never synced', () => {
  const overwrites = buildClientChannelOverwrites({
    guildId: 'guild1',
    memberId: 'member1',
    botUserId: 'bot1',
    staffRoleIds: [],
  });
  // Even with no staff, @everyone must still be denied explicitly — the
  // category's own deny is not consulted for an unsynced channel.
  assert.deepEqual(overwrites[0], { id: 'guild1', deny: ['ViewChannel'] });
});

function makeGuild(roles) {
  return {
    roles: {
      cache: {
        find: (predicate) => roles.find(predicate) ?? undefined,
      },
    },
  };
}

test('staff role names resolve to IDs', () => {
  const guild = makeGuild([
    { id: 'r1', name: 'CSM' },
    { id: 'r2', name: 'COO' },
  ]);
  assert.deepEqual(resolveRoleIdsByName(guild, ['CSM', 'COO']), {
    ids: ['r1', 'r2'],
    missing: [],
  });
});

// Dropping a missing role silently is how a CMO ends up unable to see the
// tier they are supposed to be servicing.
test('a role that does not exist is reported, not quietly skipped', () => {
  const guild = makeGuild([{ id: 'r1', name: 'CSM' }]);
  assert.deepEqual(resolveRoleIdsByName(guild, ['CSM', 'CMO', 'Founder']), {
    ids: ['r1'],
    missing: ['CMO', 'Founder'],
  });
});
