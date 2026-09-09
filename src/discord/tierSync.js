import { CLIENTS_TABLE_ID } from '../reminders/weeklyCheckinReminder.js';
import { TIER_ROLE_NAMES, resolveTierFromRoleNames, tierRank } from './tiers.js';
import { buildClientChannelOverwrites, resolveRoleIdsByName } from './clientChannel.js';

// Discord leads, Airtable follows. The tier role is what actually gates
// access, so it is the authoritative record of what someone bought - when a
// staff member moves a client up a tier in Discord, this writes that back to
// Airtable, moves their private channel into the new tier's category, and
// logs the change. Airtable is never the one correcting Discord.
//
// Every write is announced in #tier-changes. That audit trail is the whole
// reason "Discord wins" is safe: a mis-clicked role rewrites a billing
// record, and without a log nobody would notice until renewal.

export const UPSELL = 'upsell';
export const DOWNGRADE = 'downgrade';
export const ASSIGNED = 'assigned';
export const REMOVED = 'removed';

export function hasTierRoleChange(oldRoleNames, newRoleNames) {
  const before = oldRoleNames.filter((name) => TIER_ROLE_NAMES.includes(name)).sort();
  const after = newRoleNames.filter((name) => TIER_ROLE_NAMES.includes(name)).sort();
  return before.join('|') !== after.join('|');
}

export function detectTierChange(oldRoleNames, newRoleNames) {
  if (!hasTierRoleChange(oldRoleNames, newRoleNames)) return null;

  const from = resolveTierFromRoleNames(oldRoleNames);
  const to = resolveTierFromRoleNames(newRoleNames);
  if (from?.key === to?.key) return null;

  let direction;
  if (!from) direction = ASSIGNED;
  else if (!to) direction = REMOVED;
  else direction = tierRank(to) > tierRank(from) ? UPSELL : DOWNGRADE;

  return { from, to, direction };
}

const DIRECTION_ICONS = {
  [UPSELL]: '📈',
  [DOWNGRADE]: '📉',
  [ASSIGNED]: '🆕',
  [REMOVED]: '⚠️',
};

export function formatTierChangeMessage({ memberId, displayName, change, channelId, warning }) {
  const icon = DIRECTION_ICONS[change.direction] ?? '🔄';
  const from = change.from?.name ?? 'no tier';
  const to = change.to?.name ?? 'no tier';
  const lines = [
    `${icon} **${displayName}** (<@${memberId}>): ${from} → ${to}`,
    channelId ? `Channel <#${channelId}> moved to **${change.to?.categoryName ?? 'none'}**.` : null,
    warning ? `⚠️ ${warning}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function findClientByDiscordId(airtableClient, baseId, discordUserId) {
  const escaped = String(discordUserId).replace(/'/g, "\\'");
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: `TRIM({Discord ID}) = '${escaped}'`,
  });
  return records[0] ?? null;
}

// Matched on the member's permission overwrite rather than the channel name:
// display names change, and a renamed member would otherwise strand their
// own channel behind. Only channels already parented to a tier category
// count, so a member's overwrite on some shared channel can't be mistaken
// for their private one.
export function pickClientChannel(channels, memberId, tierCategoryIds) {
  return (
    channels.find(
      (channel) =>
        tierCategoryIds.includes(channel.parentId) &&
        channel.permissionOverwrites?.some((overwrite) => overwrite.id === memberId)
    ) ?? null
  );
}

export function registerTierSync({
  discord,
  airtableClient,
  clientGuildId,
  clientSuccessBaseId,
  tierChangesChannelId,
  log = console,
}) {
  discord.client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      if (newMember.guild.id !== clientGuildId) return;

      const oldRoleNames = [...oldMember.roles.cache.values()].map((role) => role.name);
      const newRoleNames = [...newMember.roles.cache.values()].map((role) => role.name);

      const change = detectTierChange(oldRoleNames, newRoleNames);
      if (!change) return;

      const displayName = newMember.displayName ?? newMember.user.username;
      let warning = null;
      let movedChannelId = null;

      const client = await findClientByDiscordId(
        airtableClient,
        clientSuccessBaseId,
        newMember.id
      );

      if (client && change.direction === REMOVED) {
        // Losing the tier role means losing access, not un-buying the
        // program - someone finishing and becoming a Veteran is the normal
        // path here. Blanking Package / Tier would destroy the record of
        // what they actually paid for, so the tier stays and only Status
        // (which this never touches) should change.
        warning = 'Tier role removed — Package / Tier left as-is in Airtable to preserve history.';
      } else if (client) {
        await airtableClient.updateRecord(clientSuccessBaseId, CLIENTS_TABLE_ID, client.id, {
          'Package / Tier': change.to.airtableValue,
        });
      } else {
        // Not a blocker: the role change still stands and access is already
        // correct. It just means nobody can bill against it yet.
        warning = 'No Airtable Client record matched this Discord ID — tier not recorded there.';
      }

      const moved = await moveClientChannel({ discord, member: newMember, change, log });
      movedChannelId = moved.channelId;
      if (moved.warning) warning = warning ? `${warning} ${moved.warning}` : moved.warning;

      if (tierChangesChannelId) {
        await discord.sendToChannel(
          tierChangesChannelId,
          formatTierChangeMessage({
            memberId: newMember.id,
            displayName,
            change,
            channelId: movedChannelId,
            warning,
          })
        );
      }

      log.info(
        `[tierSync] ${displayName}: ${change.from?.name ?? 'none'} -> ${change.to?.name ?? 'none'}`
      );
    } catch (err) {
      log.error('[tierSync] guildMemberUpdate handler failed:', err);
    }
  });
}

async function moveClientChannel({ discord, member, change, log }) {
  if (!change.to?.hasPrivateChannel) {
    return { channelId: null, warning: null };
  }

  try {
    const guild = member.guild;
    const channels = [...guild.channels.cache.values()];
    const tierCategoryIds = channels
      .filter((channel) => String(channel.name).startsWith('CLIENTS · '))
      .map((channel) => channel.id);

    const clientChannel = pickClientChannel(channels, member.id, tierCategoryIds);
    if (!clientChannel) {
      return { channelId: null, warning: 'No private channel found to move.' };
    }

    const target = channels.find(
      (channel) => channel.name === change.to.categoryName && !channel.parentId
    );
    if (!target) {
      return {
        channelId: clientChannel.id,
        warning: `Category "${change.to.categoryName}" not found — channel left where it was.`,
      };
    }

    // lockPermissions:false is load-bearing. Syncing to the category would
    // wipe the one overwrite that grants the client access to their own
    // channel, locking them out of their own onboarding thread.
    await clientChannel.setParent(target.id, { lockPermissions: false });

    // Re-parenting alone changes nothing about access: an unsynced channel's
    // permissions come from its own overwrites, never from its category. So
    // the staff list has to be rewritten here or an upsell would move the
    // channel under CLIENTS · MOMENTUM while Andrew and Nigel still can't
    // see it - exactly the bug this whole restructure exists to fix.
    const { ids: staffRoleIds, missing } = resolveRoleIdsByName(guild, change.to.staffRoleNames);
    await clientChannel.permissionOverwrites.set(
      buildClientChannelOverwrites({
        guildId: guild.id,
        memberId: member.id,
        botUserId: guild.client.user.id,
        staffRoleIds,
      })
    );

    return {
      channelId: clientChannel.id,
      warning:
        missing.length > 0
          ? `Roles not found, so they were left out of the channel: ${missing.join(', ')}.`
          : null,
    };
  } catch (err) {
    log.error('[tierSync] failed to move client channel:', err);
    return { channelId: null, warning: 'Failed to move the private channel — see logs.' };
  }
}
