import { ChannelType } from 'discord.js';
import { normalizeChannelName } from './serverStructure.js';

const GRANT = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];

// Both live automations have to find a tier's category before they can put a
// channel in it, and both used to match the name exactly. Live category names
// carry decorative emoji ("\u{1F310}│welcome" is really what #welcome is
// called), so an exact match finds nothing and the channel silently lands
// with no parent - the flat list this whole restructure existed to clear.
// Every other lookup in the codebase normalizes; these two now do too.
//
// The type check matters as much as the normalizing: a top-level text channel
// called MOMENTUM would otherwise match, and the move would fail with
// something far more confusing than "not found".
export function findCategoryByName(channels, name) {
  return (
    [...channels].find(
      (channel) =>
        channel?.type === ChannelType.GuildCategory &&
        normalizeChannelName(channel.name) === normalizeChannelName(name)
    ) ?? null
  );
}

// Builds the complete overwrite set for one client's private channel.
//
// It has to be complete, not a delta on the category. Discord only consults a
// category's overwrites for channels that are *synced* to it, and a client
// channel can never be synced - it carries one overwrite the category can't
// (the client's own access), which desyncs it by definition. So moving a
// channel between tier categories changes nothing about who can see it
// unless the overwrites are rewritten too. That is why tierSync calls this
// on every tier move rather than only re-parenting.
export function buildClientChannelOverwrites({ guildId, memberId, botUserId, staffRoleIds = [] }) {
  return [
    { id: guildId, deny: ['ViewChannel'] },
    { id: memberId, allow: GRANT },
    { id: botUserId, allow: GRANT },
    // Deduped: Nigel is both Founder and a CSM in Airtable, so a tier's
    // staff list can resolve to the same role twice, and Discord rejects a
    // duplicate overwrite target.
    ...[...new Set(staffRoleIds.filter(Boolean))].map((id) => ({ id, allow: GRANT })),
  ];
}

// Tiers and invite slots name their roles in plain text; Discord needs IDs.
// Missing roles are reported rather than dropped, because silently omitting
// one is how a CMO ends up unable to see the tier they're meant to service,
// or a new client lands with no tier at all.
export function resolveRoleIdsByName(guild, roleNames) {
  const ids = [];
  const missing = [];
  for (const name of roleNames) {
    const role = guild.roles.cache.find((r) => r.name === name);
    if (role) ids.push(role.id);
    else missing.push(name);
  }
  return { ids, missing };
}
