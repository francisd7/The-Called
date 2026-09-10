import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  CATEGORIES,
  EVERYONE,
  mergeOverwrites,
  resolveChannelOverwrites,
  findUnknownOverwriteRoles,
  normalizeChannelName,
  visibleChannelsFor,
  allRoleNames,
} from '../src/discord/serverStructure.js';
import {
  TIERS,
  TIER_ROLE_NAMES,
  getTierByKey,
  resolveTierFromRoleNames,
} from '../src/discord/tiers.js';

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
test('TRAINING HUB is closed to Foundations and to the bible-study tier', () => {
  for (const name of ['TRAINING HUB']) {
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

// #wins is the upsell surface: bible-study members and veterans must be able
// to read what the paid tiers produce, without being able to reach what
// produced it or post into it.
test('#wins lets the bible-study tier read but not post', () => {
  const wins = categoryNamed('THE FORGE').channels.find((c) => c.name === 'wins');
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

test('#wins is the only wins channel, and it lives in THE FORGE', () => {
  const winsLocations = CATEGORIES.filter((cat) =>
    cat.channels.some((channel) => channel.name === 'wins')
  ).map((cat) => cat.name);
  assert.deepEqual(winsLocations, ['THE FORGE']);
});

// The mechanic this depends on: Discord resolves a channel against its OWN
// overwrites, never its category's, so an unpaid tier granted here sees THE
// FORGE containing #wins alone. If that ever regressed, either they'd lose
// the upsell surface or they'd gain the whole paid work area.
test('the unpaid tiers reach #wins without reaching the rest of THE FORGE', () => {
  const forge = categoryNamed('THE FORGE');
  for (const role of ['Tier: The Called', 'Veteran']) {
    assert.equal(grantFor(forge, role), undefined, `${role} must not hold a category grant`);
  }
  const wins = forge.channels.find((c) => c.name === 'wins');
  const granted = resolveChannelOverwrites(wins).map((o) => o.role);
  assert.deepEqual(granted, ['Tier: The Called', 'Veteran']);

  // Every other channel in THE FORGE stays closed to them.
  for (const channel of forge.channels.filter((c) => c.name !== 'wins')) {
    const roles = resolveChannelOverwrites(channel).map((o) => o.role);
    assert.equal(roles.includes('Tier: The Called'), false, channel.name);
    assert.equal(roles.includes('Veteran'), false, channel.name);
  }
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
  // Coach reaches the category (announcements + chat), but tiers.js keeps
  // both CMO and Nigel out of a Foundations client's private channel.
  assert.deepEqual(getTierByKey('foundations').staffRoleNames, ['CSM', 'COO']);
  assert.deepEqual(getTierByKey('momentum').staffRoleNames, ['CSM', 'CMO', 'Nigel', 'COO']);
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
  for (const name of ['content-review', 'masterclass-recordings', 'reel-ideas']) {
    assert.ok(names.includes(name), name);
  }
});

// Staff work in the ops server, where the bot's output already goes. A staff
// chat here would have been one more place to watch.
test('there is no staff-only category in the client server', () => {
  assert.equal(categoryNamed('STAFF'), undefined);
  for (const cat of CATEGORIES) {
    const clientRoles = cat.overwrites
      .filter((o) => o.allow)
      .map((o) => o.role)
      .filter((r) => !['CMO', 'COO', 'CSM', 'Coach', 'Nigel'].includes(r));
    assert.ok(clientRoles.length > 0, `${cat.name} would be staff-only`);
  }
});

// Eddie's weekly call lives in TRAINING HUB, not a tier category. Putting it
// under MOMENTUM left Inner Circle without it — the one place the ladder
// broke, since a higher tier should reach everything a lower one does.
test('every tier category holds exactly its announcements and chat', () => {
  for (const tier of TIERS.filter((t) => t.hasPrivateChannel)) {
    assert.deepEqual(
      categoryNamed(tier.categoryName).channels.map((c) => c.name),
      [`${tier.key}-announcements`, `${tier.key}-chat`],
      tier.categoryName
    );
  }
});

test('the top two tiers reach the training material identically', () => {
  const hub = categoryNamed('TRAINING HUB');
  assert.ok(grantFor(hub, 'Tier: Momentum'));
  assert.ok(grantFor(hub, 'Tier: Inner Circle'));
  assert.deepEqual(
    grantFor(hub, 'Tier: Momentum').allow,
    grantFor(hub, 'Tier: Inner Circle').allow
  );
});

// Coach reaches every category, including the tier ones, but never a
// client's private channel - those are built from tiers.js staffRoleNames,
// which deliberately omits it. That is "everything staff see except private
// client chats" expressed in one place.
test('Coach reaches every category but no private client channel', () => {
  for (const cat of CATEGORIES) {
    if (cat.name === 'WELCOME') continue;
    assert.ok(grantFor(cat, 'Coach'), `Coach should reach ${cat.name}`);
  }
  for (const tier of TIERS.filter((t) => t.hasPrivateChannel)) {
    assert.equal(
      tier.staffRoleNames.includes('Coach'),
      false,
      `${tier.name} private channels must exclude Coach`
    );
  }
});

test('Coach can schedule the weekly call it exists to run', () => {
  const coach = ROLES.find((r) => r.name === 'Coach');
  assert.deepEqual(coach.permissions, ['ManageEvents']);
});

// The role is named for the seat everywhere except this one, which the user
// kept as-is because it is integration-managed and cannot be renamed.
test('the founder role is Nigel, and no Founder role is created alongside it', () => {
  assert.ok(ROLES.find((r) => r.name === 'Nigel'));
  assert.equal(ROLES.find((r) => r.name === 'Founder'), undefined);
  for (const tier of TIERS.filter((t) => t.hasPrivateChannel && t.staffRoleNames.length > 2)) {
    assert.ok(tier.staffRoleNames.includes('Nigel'), tier.name);
    assert.equal(tier.staffRoleNames.includes('Founder'), false, tier.name);
  }
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
  assert.deepEqual(reachable.sort(), ['THE CALLED', 'VETERANS']);
  const veterans = categoryNamed('VETERANS').channels.map((c) => c.name);
  assert.deepEqual(veterans, ['veterans-chat']);

  for (const name of ['THE FORGE', 'TRAINING HUB', 'FOUNDATIONS', 'MOMENTUM']) {
    assert.equal(grantFor(categoryNamed(name), 'Veteran'), undefined, name);
  }
});

test('a Veteran can read #wins but not post into it', () => {
  const wins = categoryNamed('THE FORGE').channels.find((c) => c.name === 'wins');
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
    'masterclass-recordings',
    'training-recordings',
  ]);
});

// An empty category reads as a neglected server. #links in THE FORGE covers
// what RESOURCES was going to hold.
test('no category is declared empty', () => {
  const empty = CATEGORIES.filter((cat) => cat.channels.length === 0).map((cat) => cat.name);
  assert.deepEqual(empty, []);
});

// Brand-specific chat was dropped: per-tier conversation happens in each
// tier's own channel, and one shared forge chat covers the rest.
test('THE FORGE has one shared chat, not a chat per brand', () => {
  const names = categoryNamed('THE FORGE').channels.map((c) => c.name);
  assert.ok(names.includes('the-forge-chat'));
  assert.equal(names.includes('coaches-general'), false);
  assert.equal(names.includes('creators-general'), false);
});

// Two categories with identical permissions, one down to a single live
// channel, is the same problem RESOURCES had.
test('sales, setting and the weekly call are one training category', () => {
  for (const gone of ['SETTING', 'SALES', 'SALES & SETTING']) {
    assert.equal(categoryNamed(gone), undefined, gone);
  }
  const merged = categoryNamed('TRAINING HUB');
  const names = merged.channels.map((c) => c.name);
  // One recordings channel for both disciplines; reviews stay split because
  // a DM thread and a closing call aren't critiqued the same way.
  assert.ok(names.includes('training-recordings'));
  assert.ok(names.includes('convo-reviews'));
  // Call reviews fold into training-recordings; convo-reviews stays separate.
  assert.equal(names.includes('call-reviews'), false);
  assert.ok(grantFor(merged, 'Tier: Momentum'));
  assert.ok(grantFor(merged, 'Tier: Inner Circle'));
  assert.equal(grantFor(merged, 'Tier: Foundations'), undefined);
  assert.ok(merged.channels.some((c) => c.name === 'sales-general'));
  assert.ok(merged.channels.some((c) => c.name === 'setting-general'));
});

// Resolving what a role actually sees is the check that matters before
// applying anything, and it is not answerable by reading the config alone —
// the answer depends on Discord judging a channel by its own overwrites
// rather than its category's.
test('the bible-study tier reaches THE FORGE only through #wins', () => {
  const forge = visibleChannelsFor('Tier: The Called').filter((c) => c.category === 'THE FORGE');
  assert.deepEqual(forge, [{ category: 'THE FORGE', channel: 'wins', canPost: false }]);
});

test('a Foundations client reaches all of THE FORGE and can post in #wins', () => {
  const forge = visibleChannelsFor('Tier: Foundations').filter((c) => c.category === 'THE FORGE');
  assert.equal(forge.length, categoryNamed('THE FORGE').channels.length);
  assert.equal(forge.find((c) => c.channel === 'wins').canPost, true);
});

// The ladder: every tier reaches everything the tier below it does. This was
// broken while Eddie's weekly call sat under MOMENTUM, leaving Inner Circle
// without it — TRAINING HUB is what fixed it.
test('each tier reaches a superset of the tier below', () => {
  const key = (c) => `${c.category}/${c.channel}`;
  const ladder = ['Tier: Foundations', 'Tier: Momentum', 'Tier: Inner Circle'];
  for (let i = 1; i < ladder.length; i += 1) {
    const lower = new Set(
      visibleChannelsFor(ladder[i - 1])
        .filter((c) => !c.category.match(/^(FOUNDATIONS|MOMENTUM|INNER CIRCLE)$/))
        .map(key)
    );
    const higher = new Set(visibleChannelsFor(ladder[i]).map(key));
    for (const channel of lower) {
      assert.ok(higher.has(channel), `${ladder[i]} must also reach ${channel}`);
    }
  }
});

test('nobody unpaid reaches the training material', () => {
  for (const role of ['Tier: The Called', 'Veteran']) {
    const hub = visibleChannelsFor(role).filter((c) => c.category === 'TRAINING HUB');
    assert.deepEqual(hub, [], role);
  }
});

// Live channel names carry decorative emoji and separators, so matching on
// the exact string finds nothing and the apply script would create a
// duplicate of every channel that already exists. This is what the first
// real dry run caught.
test('channel names normalize past emoji, separators and case', () => {
  assert.equal(normalizeChannelName('🌐│welcome'), 'welcome');
  assert.equal(normalizeChannelName('🌐 | welcome'), 'welcome');
  assert.equal(normalizeChannelName('welcome'), 'welcome');
  assert.equal(normalizeChannelName('⚔️ | Warrior Huddle'), 'warriorhuddle');
  assert.equal(normalizeChannelName('Warrior Huddle'), 'warriorhuddle');
  assert.equal(normalizeChannelName('📅|training-recordings'), 'trainingrecordings');
});

// Normalizing is only safe while no two declared channels collapse onto the
// same value — if they did, the matcher could bind one to the other's
// existing channel and rewrite the wrong permissions.
test('no two declared channels normalize to the same name', () => {
  const names = CATEGORIES.flatMap((cat) => cat.channels).map((c) => normalizeChannelName(c.name));
  assert.equal(new Set(names).size, names.length);
});
