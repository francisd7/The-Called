import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  CATEGORIES,
  EVERYONE,
  mergeOverwrites,
  resolveChannelOverwrites,
  findUnknownOverwriteRoles,
  isExclusiveChannel,
  exclusiveChannelOverwrites,
  allRoleNames,
} from '../src/discord/serverStructure.js';
import { TIERS, TIER_ROLE_NAMES, resolveTierFromRoleNames } from '../src/discord/tiers.js';

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
test('SETTING & SALES is closed to Foundations and to the bible-study tier', () => {
  for (const name of ['SETTING & SALES']) {
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

// Each tier's category is that tier's whole home: announcements, chat, and
// its private client channels underneath.
test('every tier with private channels has its own category', () => {
  const names = CATEGORIES.map((cat) => cat.name);
  for (const tier of TIERS.filter((t) => t.hasPrivateChannel)) {
    assert.ok(names.includes(tier.categoryName), tier.categoryName);
  }
  assert.equal(names.includes('CLIENTS · MOMENTUM'), false, 'the old prefix is gone');
});

// The gap this closes: before, there was nowhere to tell every Momentum
// client something without messaging the whole server.
test('each tier gets its own announcements and chat channel', () => {
  for (const tier of TIERS.filter((t) => t.hasPrivateChannel)) {
    const cat = categoryNamed(tier.categoryName);
    assert.deepEqual(
      cat.channels.map((c) => c.name),
      [`${tier.key}-announcements`, `${tier.key}-chat`],
      tier.categoryName
    );
    // Announcements are staff-to-tier, so clients read but don't post.
    const announce = resolveChannelOverwrites(cat.channels[0]).find(
      (o) => o.role === tier.roleName
    );
    assert.deepEqual(announce.deny, ['SendMessages'], tier.categoryName);
  }
});

test('a tier category is visible to its own tier and to nobody else’s', () => {
  const momentum = categoryNamed('MOMENTUM');
  assert.ok(grantFor(momentum, 'Tier: Momentum'));
  assert.equal(grantFor(momentum, 'Tier: Foundations'), undefined);
  assert.equal(grantFor(momentum, 'Tier: Inner Circle'), undefined);
});

test('FOUNDATIONS excludes the CMO and Founder', () => {
  const foundations = categoryNamed('FOUNDATIONS');
  assert.ok(grantFor(foundations, 'CSM'));
  assert.ok(grantFor(foundations, 'COO'));
  assert.equal(grantFor(foundations, 'CMO'), undefined);
  assert.equal(grantFor(foundations, 'Founder'), undefined);

  const momentum = categoryNamed('MOMENTUM');
  assert.ok(grantFor(momentum, 'CMO'));
  assert.ok(grantFor(momentum, 'Founder'));
});

// Course content is delivered in each client's private channel, so the
// per-brand categories had nothing left worth splitting. Brand is now a
// label and an @-mention target that gates nothing.
test('brand roles exist but gate no category', () => {
  for (const brandRole of ['Called Coaches', 'Called Creators']) {
    assert.ok(ROLES.find((r) => r.name === brandRole), brandRole);
    const gated = CATEGORIES.filter((cat) => grantFor(cat, brandRole));
    assert.deepEqual(gated, [], `${brandRole} should gate nothing`);
  }
  assert.equal(categoryNamed('CALLED COACHES'), undefined);
  assert.equal(categoryNamed('CALLED CREATORS'), undefined);
});

test('there is no course-content channel anywhere', () => {
  const found = CATEGORIES.flatMap((cat) => cat.channels).filter(
    (c) => c.name === 'course-content'
  );
  assert.deepEqual(found, []);
});

// The work channels the brand categories used to hold now live in one place
// open to every paying tier.
test('THE FORGE holds the shared work channels for all paying tiers', () => {
  const forge = categoryNamed('THE FORGE');
  const names = forge.channels.map((c) => c.name);
  for (const name of ['content-review', 'coaching-recordings', 'links']) {
    assert.ok(names.includes(name), name);
  }
});

test('STAFF is staff-only', () => {
  const granted = categoryNamed('STAFF')
    .overwrites.filter((o) => o.allow)
    .map((o) => o.role);
  assert.deepEqual(granted.sort(), ['CMO', 'COO', 'CSM', 'Founder']);
});

// Pods are no longer used, so the config declares nothing about them and the
// apply script (which never deletes) leaves the existing channels alone.
test('pods are not managed by the config at all', () => {
  assert.equal(categoryNamed('PODS'), undefined);
  const podChannels = CATEGORIES.flatMap((cat) => cat.channels).filter((channel) =>
    channel.name.startsWith('pod-')
  );
  assert.deepEqual(podChannels, []);
});

// Veterans keep lifetime community access and nothing else. Losing the paid
// areas is deliberate — seeing #wins without being able to reach what
// produced them is what brings someone back.
test('a Veteran reaches the community section and the 💪 section, and nothing else', () => {
  const reachable = CATEGORIES.filter((cat) => grantFor(cat, 'Veteran')).map((cat) => cat.name);
  assert.deepEqual(reachable.sort(), ['THE CALLED', 'VETERANS · 💪']);

  for (const name of ['THE FORGE', 'SETTING & SALES', 'FOUNDATIONS', 'MOMENTUM']) {
    assert.equal(grantFor(categoryNamed(name), 'Veteran'), undefined, name);
  }
});

test('a Veteran can read #wins but not post into it', () => {
  const wins = categoryNamed('THE CALLED').channels.find((c) => c.name === 'wins');
  const veteran = resolveChannelOverwrites(wins).find((o) => o.role === 'Veteran');
  assert.deepEqual(veteran.allow, ['ViewChannel', 'ReadMessageHistory']);
  assert.deepEqual(veteran.deny, ['SendMessages']);
});

// Veteran deliberately isn't a tier: nobody is paying for it, so tierSync
// must never see it and write a package onto a Completed/Cancelled record.
test('Veteran is not a tier role', () => {
  assert.equal(TIER_ROLE_NAMES.includes('Veteran'), false);
  assert.equal(resolveTierFromRoleNames(['Veteran']), null);
});

test('resolveChannelOverwrites expands the readOnlyFor shorthand', () => {
  assert.deepEqual(resolveChannelOverwrites({ name: 'x', readOnlyFor: ['CSM'] }), [
    { role: 'CSM', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
  ]);
  assert.deepEqual(resolveChannelOverwrites({ name: 'x' }), []);
});

// Merging the brand categories put three channels called "call-recordings"
// in front of the same client - the confusion this restructure exists to
// remove - so every one is named for what is actually in it.
test('no two channels visible to the same client share a name', () => {
  const names = CATEGORIES.flatMap((cat) => cat.channels).map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `duplicate channel name in: ${names.join(', ')}`);
});

test('every recording channel says what it records', () => {
  const recordingChannels = CATEGORIES.flatMap((cat) => cat.channels)
    .map((c) => c.name)
    .filter((name) => name.includes('recordings'))
    .sort();
  assert.deepEqual(recordingChannels, [
    'bible-study-recordings',
    'coaching-recordings',
    'setting-recordings',
  ]);
});

// An empty category reads as a neglected server. #links in THE FORGE covers
// what RESOURCES was going to hold.
test('no category is declared empty', () => {
  const empty = CATEGORIES.filter((cat) => cat.channels.length === 0).map((cat) => cat.name);
  assert.deepEqual(empty, []);
});

// Two independent gates: THE FORGE is gated on tier, and these two channels
// inside it on brand. The brand gate cuts across the tiers, not down them —
// a Foundations coach reaches everything in THE FORGE except the creators'
// chat, which is the whole point.
test('a brand chat replaces the category grants instead of adding to them', () => {
  const coaches = categoryNamed('THE FORGE').channels.find((c) => c.name === 'coaches-general');
  assert.ok(isExclusiveChannel(coaches));

  const overwrites = exclusiveChannelOverwrites(coaches);
  const granted = overwrites.filter((o) => o.allow).map((o) => o.role);

  assert.ok(granted.includes('Called Coaches'));
  assert.equal(granted.includes('Called Creators'), false);
  // If the tier roles leaked in here, every paid tier would see the coaches
  // chat and the brand gate would do nothing.
  for (const tierRole of TIER_ROLE_NAMES) {
    assert.equal(granted.includes(tierRole), false, `${tierRole} must not reach #coaches-general`);
  }
  assert.deepEqual(overwrites[0], { role: EVERYONE, deny: ['ViewChannel'] });
  // Staff still see it — they service both brands.
  for (const staff of ['Founder', 'COO', 'CMO', 'CSM']) {
    assert.ok(granted.includes(staff), staff);
  }
});

test('only the two brand chats are exclusive; the rest of THE FORGE is shared', () => {
  const forge = categoryNamed('THE FORGE');
  const exclusive = forge.channels.filter(isExclusiveChannel).map((c) => c.name);
  assert.deepEqual(exclusive, ['coaches-general', 'creators-general']);
});

// Two categories with identical permissions, one down to a single live
// channel, is the same problem RESOURCES had.
test('Setting and Sales are one category', () => {
  assert.equal(categoryNamed('SETTING'), undefined);
  assert.equal(categoryNamed('SALES'), undefined);
  const merged = categoryNamed('SETTING & SALES');
  assert.ok(grantFor(merged, 'Tier: Momentum'));
  assert.ok(grantFor(merged, 'Tier: Inner Circle'));
  assert.equal(grantFor(merged, 'Tier: Foundations'), undefined);
  assert.ok(merged.channels.some((c) => c.name === 'sales-general'));
  assert.ok(merged.channels.some((c) => c.name === 'setting-general'));
});
