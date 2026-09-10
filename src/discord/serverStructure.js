import { TIERS, TIER_ROLE_NAMES, tierRoleNamesAtOrAbove } from './tiers.js';

// The whole client-facing server as data: roles, categories, channels, and
// the permission overwrites on each. `scripts/apply-discord-structure.js`
// resolves the role names here into IDs and reconciles Discord against it,
// so this file is the thing to edit - never the server by hand, or the two
// drift and the next apply run fights you.
//
// Permission names are discord.js PermissionFlagsBits keys, matching the
// string form already used by buildChannelOverwrites() in
// src/onboarding/newMemberOnboarding.js.

export const EVERYONE = '@everyone';

const READ = ['ViewChannel', 'ReadMessageHistory'];
const READ_WRITE = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];
const VOICE = ['ViewChannel', 'Connect', 'Speak'];

export const STAFF_ROLE_NAMES = ['Founder', 'COO', 'CMO', 'CSM'];

// Ordered top-to-bottom exactly as they should sit in Discord's role list.
// Hierarchy is not cosmetic: the bot can only assign roles positioned below
// its own, so BOT_ROLE_ANCHOR marks where the bot's managed role has to sit
// - above every client role, below the humans it never manages.
export const ROLES = [
  { name: 'Founder', color: '#E6A817', hoist: true, mentionable: true },
  { name: 'COO', color: '#2C6FBB', hoist: true, mentionable: true },
  { name: 'CMO', color: '#8B5CF6', hoist: true, mentionable: true },
  { name: 'CSM', color: '#14B8A6', hoist: true, mentionable: true },

  { name: 'Called Coaches', color: '#3B82F6', hoist: true, mentionable: true },
  { name: 'Called Creators', color: '#F97316', hoist: true, mentionable: true },
  { name: 'The Called', color: '#9CA3AF', hoist: true, mentionable: true },

  // Earned, not bought - synced from Airtable's Journey Stage. These are the
  // roles that carry the visible aspirational signal, which is why the tier
  // roles below can stay hidden: a public "Foundations" label reads as what
  // someone couldn't afford, where "First Client Closed" reads as proof.
  { name: 'Consistent Clients', color: '#16A34A', hoist: true, mentionable: false },
  { name: 'First Client Closed', color: '#22C55E', hoist: true, mentionable: false },
  { name: 'Offer Built', color: '#4ADE80', hoist: true, mentionable: false },

  // Past clients with lifetime community access. Named "Veteran" rather than
  // "Alumni" deliberately - alumni reads as "former customer", veteran reads
  // as "been through it", which is what a badge sitting next to paying
  // clients in #wins should say. It is not a tier: a veteran isn't paying for
  // anything, so giving them Tier: The Called would make tierSync write a
  // package onto a Completed/Cancelled record. This role carries the
  // community grant on its own.
  { name: 'Veteran', color: '#A16207', hoist: true, mentionable: false },

  // Permission carriers only: no color, never hoisted, so they do all the
  // gating without ever showing a client what anyone paid. Flip `hoist` to
  // true if that decision is ever reversed - nothing else needs to change.
  ...TIERS.map((tier) => ({
    name: tier.roleName,
    color: null,
    hoist: false,
    mentionable: false,
  })),
];

export const BOT_ROLE_ANCHOR = 'Called Coaches';

function allow(roleNames, permissions) {
  return roleNames.map((role) => ({ role, allow: permissions }));
}

const ALL_STAFF_READ_WRITE = allow(STAFF_ROLE_NAMES, READ_WRITE);
const ALL_TIERS_READ_WRITE = allow(TIER_ROLE_NAMES, READ_WRITE);
const PAID_TIERS = tierRoleNamesAtOrAbove('foundations');
const SELLING_TIERS = tierRoleNamesAtOrAbove('momentum');

// Discord allows one overwrite per role per channel, so a role granted here
// after being denied by the baseline has to collapse into a single entry -
// two entries for @everyone (as WELCOME would otherwise produce) is rejected
// outright. Later entries win, and anything explicitly allowed is dropped
// from the deny list so the two can't contradict each other.
export function mergeOverwrites(overwrites) {
  const byRole = new Map();
  for (const overwrite of overwrites) {
    byRole.set(overwrite.role, { ...(byRole.get(overwrite.role) ?? {}), ...overwrite });
  }
  return [...byRole.values()].map((overwrite) => {
    if (!overwrite.allow || !overwrite.deny) return overwrite;
    const deny = overwrite.deny.filter((perm) => !overwrite.allow.includes(perm));
    return deny.length > 0 ? { ...overwrite, deny } : { role: overwrite.role, allow: overwrite.allow };
  });
}

// Every category starts from a hard @everyone deny. Combined with turning
// View Channel off for @everyone at the server level, this makes the server
// deny-by-default: a channel added later is invisible until something here
// grants it. That is the fix for "right now they can see it all" - the old
// server leaked because access was opt-out, not opt-in.
function category({ name, grants = [], channels = [], note }) {
  return {
    name,
    note,
    overwrites: mergeOverwrites([{ role: EVERYONE, deny: ['ViewChannel'] }, ...grants]),
    channels,
  };
}

export const CATEGORIES = [
  category({
    name: 'WELCOME',
    // The one category everyone can see, including members who have not been
    // sorted into a tier yet. Read-only: these are announcements, not chat.
    grants: [
      { role: EVERYONE, allow: READ, deny: ['SendMessages'] },
      ...ALL_STAFF_READ_WRITE,
    ],
    channels: [
      { name: 'welcome', type: 'text' },
      { name: 'start-here', type: 'text' },
      { name: 'announcements', type: 'text' },
      { name: 'book-1-1', type: 'text' },
    ],
  }),

  category({
    name: 'THE CALLED',
    // Veterans sit here alongside every paying tier - this section is the
    // lifetime community access they keep, and the only part of the server
    // they still reach. Everything they used to have is now behind a tier
    // role, which is the point: seeing #wins without being able to reach
    // what produced them is what brings someone back.
    grants: [
      ...ALL_TIERS_READ_WRITE,
      { role: 'Veteran', allow: READ_WRITE },
      ...ALL_STAFF_READ_WRITE,
    ],
    channels: [
      { name: 'general-chat', type: 'text' },
      {
        name: 'wins',
        type: 'text',
        // One server-wide wins feed instead of a copy siloed inside each
        // brand. This is the upsell surface: bible-study members and
        // veterans can read it (and see what the paid tiers produce) but not
        // post, and Coaches and Creators can see each other's, which is the
        // point.
        overwrites: [
          { role: 'Tier: The Called', allow: READ, deny: ['SendMessages'] },
          { role: 'Veteran', allow: READ, deny: ['SendMessages'] },
        ],
      },
      { name: 'bible-study', type: 'text' },
      {
        // Warrior Huddles aren't recorded, bible study is - hence one
        // channel here rather than a catch-all "recordings". Staff post,
        // everyone reads, veterans included.
        name: 'bible-study-recordings',
        type: 'text',
        overwrites: allow([...TIER_ROLE_NAMES, 'Veteran'], READ).map((o) => ({
          ...o,
          deny: ['SendMessages'],
        })),
      },
      { name: 'Warrior Huddle', type: 'voice' },
    ],
  }),

  // The shared work area for every paying client, both brands. Course
  // content used to live in per-brand categories; it is delivered in each
  // client's private channel instead, so those categories had nothing left
  // worth splitting and the work channels moved here. Brand is now purely a
  // role - a label and an @-mention target - and gates no category at all.
  category({
    name: 'THE FORGE',
    grants: [...allow(PAID_TIERS, READ_WRITE), ...ALL_STAFF_READ_WRITE],
    channels: [
      { name: 'the-forge-chat', type: 'text' },
      { name: 'content-review', type: 'text' },
      { name: 'coaching-recordings', type: 'text', readOnlyFor: PAID_TIERS },
      { name: 'links', type: 'text', readOnlyFor: PAID_TIERS },
      { name: 'build session', type: 'voice', overwrites: allow(PAID_TIERS, VOICE) },
    ],
  }),

  category({
    name: 'SETTING',
    grants: [...allow(SELLING_TIERS, READ_WRITE), ...ALL_STAFF_READ_WRITE],
    channels: [
      { name: 'setting-general', type: 'text' },
      { name: 'setting-faq', type: 'text', readOnlyFor: SELLING_TIERS },
      { name: 'convo-reviews', type: 'text' },
      { name: 'tips', type: 'text' },
      { name: 'setting-recordings', type: 'text', readOnlyFor: SELLING_TIERS },
    ],
  }),

  category({
    name: 'SALES',
    grants: [...allow(SELLING_TIERS, READ_WRITE), ...ALL_STAFF_READ_WRITE],
    channels: [
      { name: 'sales-general', type: 'text' },
      { name: 'call-reviews', type: 'text' },
      { name: 'sales-recordings', type: 'text', readOnlyFor: SELLING_TIERS },
      { name: 'Mock Calls', type: 'voice', overwrites: allow(SELLING_TIERS, VOICE) },
    ],
  }),

  // One category per tier, and it is that tier's whole home: somewhere to
  // announce to just them, somewhere for them to talk to each other, and
  // their private client channels underneath. Before this there was nowhere
  // to tell every Momentum client something without messaging the whole
  // server.
  //
  // The tier role is granted here so clients see the two shared channels;
  // their private channel carries its own overwrite on top, which is what
  // keeps it private and what makes an upsell a single channel move.
  ...TIERS.filter((tier) => tier.hasPrivateChannel).map((tier) =>
    category({
      name: tier.categoryName,
      grants: [{ role: tier.roleName, allow: READ_WRITE }, ...allow(tier.staffRoleNames, READ_WRITE)],
      channels: [
        { name: `${tier.key}-announcements`, type: 'text', readOnlyFor: [tier.roleName] },
        { name: `${tier.key}-chat`, type: 'text' },
      ],
    })
  ),

  // Pods are no longer used, so they are deliberately absent here rather
  // than declared and locked. The apply script never deletes, so the
  // existing pod channels stay untouched in Discord - archive or delete
  // them by hand whenever you get to it.

  category({
    name: 'VETERANS · 💪',
    grants: [{ role: 'Veteran', allow: READ_WRITE }, ...ALL_STAFF_READ_WRITE],
    channels: [{ name: '💪-chat', type: 'text' }],
  }),

  // Bot output - tier-change audit lines, onboarding flags, the EOD and
  // check-in feeds - all lives in the ops server, not here. Staff work there
  // and clients are here, so declaring those channels in this server would
  // just create empty duplicates and split staff attention across two
  // places. See DISCORD_OPS_NOTIFICATIONS_CHANNEL_ID.
  category({
    name: 'STAFF',
    grants: ALL_STAFF_READ_WRITE,
    channels: [{ name: 'staff-general', type: 'text' }],
  }),
];

// `readOnlyFor` is sugar for the common "clients read, staff post" channel -
// expanded here so the apply script only ever deals with plain overwrites.
export function resolveChannelOverwrites(channel) {
  if (channel.overwrites) return channel.overwrites;
  if (channel.readOnlyFor) {
    return channel.readOnlyFor.map((role) => ({ role, allow: READ, deny: ['SendMessages'] }));
  }
  return [];
}

export function allRoleNames() {
  return ROLES.map((role) => role.name);
}

export function allCategoryNames() {
  return CATEGORIES.map((cat) => cat.name);
}

// Every role name referenced by an overwrite must exist in ROLES, or the
// apply script would silently skip that grant and quietly leave a channel
// more open than intended. Checked by a unit test rather than discovered in
// production.
export function findUnknownOverwriteRoles() {
  const known = new Set([EVERYONE, ...allRoleNames()]);
  const unknown = new Set();
  for (const cat of CATEGORIES) {
    for (const overwrite of cat.overwrites) {
      if (!known.has(overwrite.role)) unknown.add(overwrite.role);
    }
    for (const channel of cat.channels) {
      for (const overwrite of resolveChannelOverwrites(channel)) {
        if (!known.has(overwrite.role)) unknown.add(overwrite.role);
      }
    }
  }
  return [...unknown];
}
