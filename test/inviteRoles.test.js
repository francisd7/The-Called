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

test('there is one link per tier — four, not one per brand-and-tier', () => {
  // Brand gates nothing since the brand categories were deleted, so routing an
  // invite on it doubled the list the team picks from for no entitlement. With
  // seven rows a mis-pick could land on the wrong TIER, which does gate access.
  assert.equal(INVITE_SLOTS.length, 4);
  assert.deepEqual(INVITE_SLOT_KEYS, [
    'the-called',
    'foundations',
    'momentum',
    'inner-circle',
  ]);
});

test('a paid link grants the tier only — brand is assigned by hand', () => {
  assert.deepEqual(roleNamesForSlot('momentum'), ['Tier: Momentum']);
  assert.deepEqual(roleNamesForSlot('inner-circle'), ['Tier: Inner Circle']);
});

test('the bible-study link still grants its brand, which is not a choice', () => {
  // That tier has exactly one possible brand - there is no Coaches/Creators
  // split for those members - so nothing is being guessed.
  const slot = getInviteSlot('the-called');
  assert.equal(slot.brandKey, 'the-called');
  assert.deepEqual(roleNamesForSlot('the-called'), ['The Called', 'Tier: The Called']);
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
  const { map, unknownSlots } = parseInviteRoleMap(' aBcD1234=momentum , eFgH5678=foundations ');
  assert.equal(map.get('aBcD1234'), 'momentum');
  assert.equal(map.get('eFgH5678'), 'foundations');
  assert.deepEqual(unknownSlots, []);
});

test('parseInviteRoleMap reports malformed entries instead of dropping them silently', () => {
  const { map, unknownSlots } = parseInviteRoleMap('good=momentum,bad=nope,noequals');
  assert.equal(map.size, 1);
  assert.deepEqual(unknownSlots, ['bad=nope', 'noequals']);
});

test('parseInviteRoleMap handles empty and missing input', () => {
  assert.equal(parseInviteRoleMap('').map.size, 0);
  assert.equal(parseInviteRoleMap(undefined).map.size, 0);
  assert.equal(parseInviteRoleMap(',,  ,').map.size, 0);
});

// A package with no mapped link silently downgrades every buyer of it to no
// tier, so this is surfaced at startup rather than discovered by a client.
test('findUnmappedSlots names the packages with no working link yet', () => {
  const { map } = parseInviteRoleMap('a=momentum');
  const unmapped = findUnmappedSlots(map);
  assert.equal(unmapped.length, 3);
  assert.ok(!unmapped.includes('momentum'));
  assert.ok(unmapped.includes('inner-circle'));
});

test('resolveInvite turns a code into the tier and roles to assign', () => {
  const { map } = parseInviteRoleMap('aBcD1234=inner-circle');
  const resolved = resolveInvite('aBcD1234', map);
  // No brand on a paid link, so the starter Airtable record has no Brand
  // either - it joins CSM and Contract Value on the CSM's review list.
  assert.equal(resolved.brand, null);
  assert.equal(resolved.tier.name, 'Inner Circle');
  assert.equal(resolved.tier.categoryName, 'INNER CIRCLE');
  assert.deepEqual(resolved.roleNames, ['Tier: Inner Circle']);
});

test('resolveInvite returns null for a code nobody mapped', () => {
  const { map } = parseInviteRoleMap('aBcD1234=inner-circle');
  assert.equal(resolveInvite('unknown', map), null);
});
