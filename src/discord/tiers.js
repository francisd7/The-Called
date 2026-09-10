// The tier ladder, lowest to highest. This array is the single source of
// truth for the restructure - role names, category names, which staff sit in
// a client's private channel, and whether a tier move is an upsell or a
// downgrade all key off it. Add a tier here and the structure config, the
// invite map, and the sync logic all pick it up.
//
// Names were chosen to describe the program rather than the price: a client
// seeing "Foundations" reads it as where he's building from, where "Entry"
// read as what he couldn't afford.
//
// `airtableValue` must match the `Package / Tier` select option EXACTLY,
// because that is what gets written back on a tier change and Airtable
// rejects a value that isn't an existing option. The old name is kept in
// parentheses there while the team gets used to the new ones. Reads go
// through getTierByAirtableValue, which ignores that parenthetical - so
// dropping it later only means updating these four strings, and nothing
// breaks in the meantime.
export const TIERS = [
  {
    key: 'the-called',
    name: 'The Called',
    airtableValue: 'The Called (Bible Study & Warrior Huddles)',
    roleName: 'Tier: The Called',
    // Bible study + Warrior Huddles only. No private channel, so no client
    // category and nobody to assign - the one tier that lives entirely in
    // the shared THE CALLED section.
    hasPrivateChannel: false,
    categoryName: null,
    staffRoleNames: [],
  },
  {
    key: 'foundations',
    name: 'Foundations',
    airtableValue: 'Foundations (Entry)',
    roleName: 'Tier: Foundations',
    hasPrivateChannel: true,
    categoryName: 'FOUNDATIONS',
    // The whole point of the tier categories: Andrew (CMO) and Nigel only
    // service the top two tiers, so they are deliberately absent here.
    staffRoleNames: ['CSM', 'COO'],
  },
  {
    key: 'momentum',
    name: 'Momentum',
    airtableValue: 'Momentum (Mid)',
    roleName: 'Tier: Momentum',
    hasPrivateChannel: true,
    categoryName: 'MOMENTUM',
    staffRoleNames: ['CSM', 'CMO', 'Founder', 'COO'],
  },
  {
    key: 'inner-circle',
    name: 'Inner Circle',
    airtableValue: 'Inner Circle (High)',
    roleName: 'Tier: Inner Circle',
    hasPrivateChannel: true,
    categoryName: 'INNER CIRCLE',
    staffRoleNames: ['CSM', 'CMO', 'Founder', 'COO'],
  },
];

export const TIER_ROLE_NAMES = TIERS.map((tier) => tier.roleName);

// The categories that hold private client channels. tierSync uses this to
// find a client's own channel, so it must be derived from the tier list
// rather than matched on a name prefix - a prefix check silently stops
// working the day a category is renamed.
export const TIER_CATEGORY_NAMES = TIERS.filter((tier) => tier.hasPrivateChannel).map(
  (tier) => tier.categoryName
);

export function getTierByKey(key) {
  return TIERS.find((tier) => tier.key === key) ?? null;
}

export function getTierByRoleName(roleName) {
  return TIERS.find((tier) => tier.roleName === roleName) ?? null;
}

// Matches on the tier name, ignoring any trailing parenthetical, so both
// "Momentum (Mid)" and a future cleaned-up "Momentum" resolve to the same
// tier. Without this, the day someone tidies the Airtable option names every
// read would silently start returning null - which reads as "this client has
// no tier" and would quietly stop flagging mismatches.
export function getTierByAirtableValue(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return TIERS.find((tier) => tier.name.toLowerCase() === normalized) ?? null;
}

// Rank is the array index, so a higher number is a higher tier. Used to
// label a change as an upsell or a downgrade in the #tier-changes audit
// log - the direction is worth knowing at a glance, since a downgrade is
// usually either a mistake or a churn signal.
export function tierRank(tier) {
  return TIERS.findIndex((t) => t.key === tier?.key);
}

// Every tier at or above `key`, for entitlements phrased as "Foundations and
// up" (THE FORGE, the brand categories) or "Momentum and up" (SETTING,
// SALES). Keeps the structure config from hardcoding tier lists that would
// silently go stale when a tier is added.
export function tiersAtOrAbove(key) {
  const index = TIERS.findIndex((tier) => tier.key === key);
  if (index === -1) return [];
  return TIERS.slice(index);
}

export function tierRoleNamesAtOrAbove(key) {
  return tiersAtOrAbove(key).map((tier) => tier.roleName);
}

// A member should only ever carry one tier role. Given the roles they hold
// after an update, this picks the highest one so a mid-change moment where
// both the old and new role are briefly present resolves to the new tier
// rather than flapping.
export function resolveTierFromRoleNames(roleNames) {
  const held = TIERS.filter((tier) => roleNames.includes(tier.roleName));
  if (held.length === 0) return null;
  return held.reduce((highest, tier) => (tierRank(tier) > tierRank(highest) ? tier : highest));
}
