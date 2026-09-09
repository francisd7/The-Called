import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_SLOTS,
  INVITE_SLOT_KEYS,
  getInviteSlot,
  roleNamesForSlot,
  parseInviteRoleMap,
  findUnmappedSlots,
  resolveInvite,
} from '../src/discord/inviteRoles.js';

test('there is one link per sellable package — seven in total', () => {
  assert.equal(INVITE_SLOTS.length, 7);
  assert.deepEqual(INVITE_SLOT_KEYS, [
    'the-called:the-called',
    'coaches:foundations',
    'creators:foundations',
    'coaches:momentum',
    'creators:momentum',
    'coaches:inner-circle',
    'creators:inner-circle',
  ]);
});

test('the bible-study package has no brand split', () => {
  const slots = INVITE_SLOTS.filter((slot) => slot.tierKey === 'the-called');
  assert.equal(slots.length, 1);
  assert.equal(slots[0].brandKey, 'the-called');
});

test('a slot grants exactly a brand role and a tier role', () => {
  assert.deepEqual(roleNamesForSlot('coaches:momentum'), ['Called Coaches', 'Tier: Momentum']);
  assert.deepEqual(roleNamesForSlot('creators:inner-circle'), [
    'Called Creators',
    'Tier: Inner Circle',
  ]);
  assert.deepEqual(roleNamesForSlot('the-called:the-called'), ['The Called', 'Tier: The Called']);
});

test('an invite never grants a staff or achievement role', () => {
  for (const key of INVITE_SLOT_KEYS) {
    for (const roleName of roleNamesForSlot(key)) {
      assert.ok(
        !['Founder', 'COO', 'CMO', 'CSM', 'Offer Built', 'First Client Closed'].includes(roleName),
        `${key} must not grant ${roleName}`
      );
    }
  }
});

test('an unknown slot yields no roles rather than throwing', () => {
  assert.deepEqual(roleNamesForSlot('nope:nope'), []);
  assert.equal(getInviteSlot('nope'), null);
});

test('parseInviteRoleMap reads code=slot pairs and tolerates loose whitespace', () => {
  const { map, unknownSlots } = parseInviteRoleMap(
    ' aBcD1234=coaches:momentum , eFgH5678=creators:foundations '
  );
  assert.equal(map.get('aBcD1234'), 'coaches:momentum');
  assert.equal(map.get('eFgH5678'), 'creators:foundations');
  assert.deepEqual(unknownSlots, []);
});

test('parseInviteRoleMap reports malformed entries instead of dropping them silently', () => {
  const { map, unknownSlots } = parseInviteRoleMap('good=coaches:momentum,bad=nope:nope,noequals');
  assert.equal(map.size, 1);
  assert.deepEqual(unknownSlots, ['bad=nope:nope', 'noequals']);
});

test('parseInviteRoleMap handles empty and missing input', () => {
  assert.equal(parseInviteRoleMap('').map.size, 0);
  assert.equal(parseInviteRoleMap(undefined).map.size, 0);
  assert.equal(parseInviteRoleMap(',,  ,').map.size, 0);
});

// A package with no mapped link silently downgrades every buyer of it to no
// tier, so this is surfaced at startup rather than discovered by a client.
test('findUnmappedSlots names the packages with no working link yet', () => {
  const { map } = parseInviteRoleMap('a=coaches:momentum');
  const unmapped = findUnmappedSlots(map);
  assert.equal(unmapped.length, 6);
  assert.ok(!unmapped.includes('coaches:momentum'));
  assert.ok(unmapped.includes('creators:inner-circle'));
});

test('resolveInvite turns a code into the brand, tier and roles to assign', () => {
  const { map } = parseInviteRoleMap('aBcD1234=creators:inner-circle');
  const resolved = resolveInvite('aBcD1234', map);
  assert.equal(resolved.brand.name, 'Called Creators');
  assert.equal(resolved.tier.name, 'Inner Circle');
  assert.equal(resolved.tier.categoryName, 'CLIENTS · INNER CIRCLE');
  assert.deepEqual(resolved.roleNames, ['Called Creators', 'Tier: Inner Circle']);
});

test('resolveInvite returns null for a code nobody mapped', () => {
  const { map } = parseInviteRoleMap('aBcD1234=creators:inner-circle');
  assert.equal(resolveInvite('unknown', map), null);
});
