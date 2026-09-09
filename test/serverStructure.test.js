import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  CATEGORIES,
  EVERYONE,
  mergeOverwrites,
  resolveChannelOverwrites,
  findUnknownOverwriteRoles,
  allRoleNames,
} from '../src/discord/serverStructure.js';

function categoryNamed(name) {
  return CATEGORIES.find((cat) => cat.name === name);
}

function grantFor(category, roleName) {
  return category.overwrites.find((overwrite) => overwrite.role === roleName);
}

// The safety net: an overwrite naming a role that doesn't exist would be
// skipped at apply time, silently leaving a channel more open than intended.
test('every overwrite names a role that actually exists', () => {
  assert.deepEqual(findUnknownOverwriteRoles(), []);
});

test('role names are unique', () => {
  const names = allRoleNames();
  assert.equal(new Set(names).size, names.length);
});

test('tier roles are never hoisted or colored', () => {
  const tierRoles = ROLES.filter((role) => role.name.startsWith('Tier: '));
  assert.equal(tierRoles.length, 4);
  for (const role of tierRoles) {
    assert.equal(role.hoist, false, role.name);
    assert.equal(role.color, null, role.name);
  }
});

test('achievement roles are hoisted, since they carry the visible signal instead', () => {
  for (const name of ['Offer Built', 'First Client Closed', 'Consistent Clients']) {
    assert.equal(ROLES.find((role) => role.name === name).hoist, true, name);
  }
});

// Deny-by-default is the fix for "right now they can see it all".
test('every category denies @everyone except WELCOME, which is read-only', () => {
  for (const category of CATEGORIES) {
    const everyone = grantFor(category, EVERYONE);
    if (category.name === 'WELCOME') {
      assert.deepEqual(everyone.allow, ['ViewChannel', 'ReadMessageHistory']);
      assert.deepEqual(everyone.deny, ['SendMessages']);
    } else {
      assert.deepEqual(everyone.deny, ['ViewChannel'], category.name);
      assert.equal(everyone.allow, undefined, category.name);
    }
  }
});

test('mergeOverwrites collapses a role granted after the baseline deny', () => {
  const merged = mergeOverwrites([
    { role: EVERYONE, deny: ['ViewChannel'] },
    { role: EVERYONE, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
  ]);
  assert.equal(merged.length, 1, 'Discord rejects two overwrites for the same role');
  assert.deepEqual(merged[0].allow, ['ViewChannel', 'ReadMessageHistory']);
  assert.deepEqual(merged[0].deny, ['SendMessages']);
});

test('mergeOverwrites never leaves a permission both allowed and denied', () => {
  const merged = mergeOverwrites([
    { role: 'CSM', deny: ['ViewChannel'] },
    { role: 'CSM', allow: ['ViewChannel'] },
  ]);
  assert.deepEqual(merged, [{ role: 'CSM', allow: ['ViewChannel'] }]);
});

// The entitlement the user called out directly: low ticket must not reach
// Setting or Sales.
test('SETTING and SALES are closed to Foundations and to the bible-study tier', () => {
  for (const name of ['SETTING', 'SALES']) {
    const category = categoryNamed(name);
    assert.equal(grantFor(category, 'Tier: Foundations'), undefined, name);
    assert.equal(grantFor(category, 'Tier: The Called'), undefined, name);
    assert.ok(grantFor(category, 'Tier: Momentum'), name);
    assert.ok(grantFor(category, 'Tier: Inner Circle'), name);
  }
});

test('THE FORGE is open to every paying tier but not the bible-study tier', () => {
  const forge = categoryNamed('THE FORGE');
  assert.equal(grantFor(forge, 'Tier: The Called'), undefined);
  for (const role of ['Tier: Foundations', 'Tier: Momentum', 'Tier: Inner Circle']) {
    assert.ok(grantFor(forge, role), role);
  }
});

test('THE CALLED is open to all four tiers', () => {
  const category = categoryNamed('THE CALLED');
  for (const role of [
    'Tier: The Called',
    'Tier: Foundations',
    'Tier: Momentum',
    'Tier: Inner Circle',
  ]) {
    assert.deepEqual(grantFor(category, role).allow, [
      'ViewChannel',
      'SendMessages',
      'ReadMessageHistory',
    ]);
  }
});

// #wins is the upsell surface: bible-study members must be able to read what
// the paid tiers produce, without being able to post into it.
test('#wins lets the bible-study tier read but not post', () => {
  const wins = categoryNamed('THE CALLED').channels.find((c) => c.name === 'wins');
  const overwrites = resolveChannelOverwrites(wins);
  const theCalled = overwrites.find((o) => o.role === 'Tier: The Called');
  assert.deepEqual(theCalled.allow, ['ViewChannel', 'ReadMessageHistory']);
  assert.deepEqual(theCalled.deny, ['SendMessages']);
  assert.equal(
    overwrites.find((o) => o.role === 'Tier: Momentum'),
    undefined,
    'paying tiers keep the category grant, which lets them post'
  );
});

test('#wins is the only wins channel, and it lives in the shared section', () => {
  const winsLocations = CATEGORIES.filter((cat) =>
    cat.channels.some((channel) => channel.name === 'wins')
  ).map((cat) => cat.name);
  assert.deepEqual(winsLocations, ['THE CALLED']);
});

test('each brand category is gated on its own brand role alone', () => {
  const coaches = categoryNamed('CALLED COACHES');
  assert.ok(grantFor(coaches, 'Called Coaches'));
  assert.equal(grantFor(coaches, 'Called Creators'), undefined);
  assert.equal(grantFor(coaches, 'Tier: Foundations'), undefined, 'brand gates it, not tier');
});

test('a client tier category exists for every tier with private channels', () => {
  const clientCategories = CATEGORIES.filter((cat) => cat.name.startsWith('CLIENTS · '));
  assert.deepEqual(
    clientCategories.map((cat) => cat.name),
    ['CLIENTS · FOUNDATIONS', 'CLIENTS · MOMENTUM', 'CLIENTS · INNER CIRCLE']
  );
  assert.deepEqual(
    clientCategories.map((cat) => cat.channels.length),
    [0, 0, 0],
    'client channels are created per member, never declared here'
  );
});

test('CLIENTS · FOUNDATIONS excludes the CMO and Founder', () => {
  const foundations = categoryNamed('CLIENTS · FOUNDATIONS');
  assert.ok(grantFor(foundations, 'CSM'));
  assert.ok(grantFor(foundations, 'COO'));
  assert.equal(grantFor(foundations, 'CMO'), undefined);
  assert.equal(grantFor(foundations, 'Founder'), undefined);

  const momentum = categoryNamed('CLIENTS · MOMENTUM');
  assert.ok(grantFor(momentum, 'CMO'));
  assert.ok(grantFor(momentum, 'Founder'));
});

test('STAFF and PODS are staff-only', () => {
  for (const name of ['STAFF', 'PODS']) {
    const category = categoryNamed(name);
    const granted = category.overwrites.filter((o) => o.allow).map((o) => o.role);
    assert.deepEqual(granted.sort(), ['CMO', 'COO', 'CSM', 'Founder'], name);
  }
});

test('resolveChannelOverwrites expands the readOnlyFor shorthand', () => {
  assert.deepEqual(resolveChannelOverwrites({ name: 'x', readOnlyFor: ['CSM'] }), [
    { role: 'CSM', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
  ]);
  assert.deepEqual(resolveChannelOverwrites({ name: 'x' }), []);
});
