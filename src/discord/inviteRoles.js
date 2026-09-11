import { TIERS, getTierByKey } from './tiers.js';
import { BRANDS, getBrandByKey } from './brands.js';

// Discord has no native "this invite grants this role" feature, so the bot
// builds it: one permanent invite per package, and whichever invite's use
// count went up when someone joined decides the roles they land with. See
// inviteTracker.js for the counting side - this file is only the map.
//
// One slot per tier, and deliberately not one per brand-and-tier.
//
// This used to be seven: each paid tier crossed with each product line. That
// made sense when `CALLED COACHES` and `CALLED CREATORS` were real categories
// holding course content. They were deleted in the restructure - course
// content is delivered in each client's private channel - so brand now gates
// nothing at all. It is a label and an @-mention target.
//
// Routing an invite on a dimension that gates nothing, at the cost of doubling
// the list the team picks from, is a bad trade. Worse: with seven rows to
// choose from, a mis-pick can land on the wrong TIER, which is the dimension
// that does gate access and does touch billing. Four links make the
// high-stakes choice unambiguous, and the brand role is assigned by hand.
//
// The bible-study tier keeps its brand, because that tier has exactly one
// possible brand - there is no Coaches/Creators split for those members, so
// nothing is being guessed.
export const INVITE_SLOTS = TIERS.map((tier) => ({
  key: tier.key,
  label: tier.name,
  brandKey: tier.hasPrivateChannel ? null : 'the-called',
  tierKey: tier.key,
}));

export const INVITE_SLOT_KEYS = INVITE_SLOTS.map((slot) => slot.key);

export function getInviteSlot(key) {
  return INVITE_SLOTS.find((slot) => slot.key === key) ?? null;
}

// The roles a joiner gets from a slot: their tier, plus their product line on
// the one tier where it isn't a choice. Nothing else - achievement roles are
// earned later, and staff roles are never handed out by an invite. A paid
// client's `Called Coaches` / `Called Creators` role is added by hand, and
// gates nothing if it is forgotten.
export function roleNamesForSlot(slotKey) {
  const slot = getInviteSlot(slotKey);
  if (!slot) return [];
  const brand = getBrandByKey(slot.brandKey);
  const tier = getTierByKey(slot.tierKey);
  return [brand?.roleName, tier?.roleName].filter(Boolean);
}

// Invite codes only exist once the invites are created, so the code -> slot
// mapping lives in DISCORD_INVITE_ROLE_MAP rather than in this file. An env
// var (not the JSON state file) on purpose: state.json resets on hosts
// without a persistent disk, and losing this map would silently downgrade
// every new joiner to no tier at all.
//
// Format: `code=slotKey,code=slotKey` - e.g.
//   aBcD1234=coaches:momentum,eFgH5678=creators:foundations
export function parseInviteRoleMap(raw) {
  const map = new Map();
  const unknownSlots = [];

  for (const pair of String(raw ?? '').split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      unknownSlots.push(trimmed);
      continue;
    }

    const code = trimmed.slice(0, separator).trim();
    const slotKey = trimmed.slice(separator + 1).trim();
    if (!code || !getInviteSlot(slotKey)) {
      unknownSlots.push(trimmed);
      continue;
    }
    map.set(code, slotKey);
  }

  return { map, unknownSlots };
}

// Which packages have no working link yet. Surfaced at startup rather than
// discovered when a client buys the one package nobody mapped.
export function findUnmappedSlots(map) {
  const mapped = new Set(map.values());
  return INVITE_SLOT_KEYS.filter((key) => !mapped.has(key));
}

export function resolveInvite(code, map) {
  const slotKey = map.get(code);
  if (!slotKey) return null;
  const slot = getInviteSlot(slotKey);
  return {
    slot,
    brand: getBrandByKey(slot.brandKey),
    tier: getTierByKey(slot.tierKey),
    roleNames: roleNamesForSlot(slotKey),
  };
}
