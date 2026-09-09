import { TIERS, getTierByKey } from './tiers.js';
import { BRANDS, getBrandByKey } from './brands.js';

// Discord has no native "this invite grants this role" feature, so the bot
// builds it: one permanent invite per package, and whichever invite's use
// count went up when someone joined decides the roles they land with. See
// inviteTracker.js for the counting side - this file is only the map.
//
// Seven slots: one for bible-study members (who have no brand split), plus
// each paid tier crossed with each of the two product lines. Generated
// rather than hand-listed so adding a tier or a brand can't leave a package
// without a link.
export const INVITE_SLOTS = TIERS.flatMap((tier) => {
  if (!tier.hasPrivateChannel) {
    return [
      {
        key: `the-called:${tier.key}`,
        label: tier.name,
        brandKey: 'the-called',
        tierKey: tier.key,
      },
    ];
  }
  return BRANDS.filter((brand) => brand.categoryName).map((brand) => ({
    key: `${brand.key}:${tier.key}`,
    label: `${brand.name} · ${tier.name}`,
    brandKey: brand.key,
    tierKey: tier.key,
  }));
});

export const INVITE_SLOT_KEYS = INVITE_SLOTS.map((slot) => slot.key);

export function getInviteSlot(key) {
  return INVITE_SLOTS.find((slot) => slot.key === key) ?? null;
}

// The roles a joiner gets from a slot: their product line and their tier.
// Nothing else - achievement roles are earned later, and staff roles are
// never handed out by an invite.
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
