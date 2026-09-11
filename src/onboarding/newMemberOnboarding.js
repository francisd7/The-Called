import { CLIENTS_TABLE_ID } from '../reminders/weeklyCheckinReminder.js';
import { slugifyChannelName } from './channelName.js';
import { looksLikeEmail, normalizeEmail } from './email.js';
import { formatWelcomeMessage } from './welcomeMessage.js';
import {
  buildClientChannelOverwrites,
  resolveRoleIdsByName,
  findCategoryByName,
} from '../discord/clientChannel.js';
import { resolveInvite } from '../discord/inviteRoles.js';
import { getTierByAirtableValue, getTierByKey } from '../discord/tiers.js';
import { RESOLVED, AMBIGUOUS } from '../discord/inviteTracker.js';

const PENDING_STATE_KEY = 'newMemberOnboardingPending';

// Kept for the original CSM-only shape. New joins go through
// buildClientChannelOverwrites directly with the tier's full staff list -
// which staff belong in a channel now depends on what the client bought.
export function buildChannelOverwrites({ guildId, memberId, botUserId, csmRoleId }) {
  return buildClientChannelOverwrites({
    guildId,
    memberId,
    botUserId,
    staffRoleIds: [csmRoleId],
  });
}

export async function findClientByEmail(airtableClient, baseId, email) {
  const normalized = normalizeEmail(email).replace(/'/g, "\\'");
  const formula = `LOWER(TRIM({Email})) = '${normalized}'`;
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: formula,
  });
  return records[0] ?? null;
}

// A brand-new signup almost never has an Airtable Client record yet at the
// moment they join Discord - staff logs the sale by hand, often afterward.
// So instead of waiting on that, a no-match creates a starter record right
// away that staff then fills in the rest of. The invite link supplies
// Package / Tier, which is the field worth getting right automatically - it
// gates access and it is what an upsell moves. Brand, CSM and Contract Value
// are left for the CSM's review, Brand because the links are one per tier
// rather than one per brand-and-tier: see inviteRoles.js for why.
export function buildNewClientFields({
  displayName,
  email,
  discordUserId,
  joinDate,
  brandValue,
  tierValue,
}) {
  return {
    'Client Name': displayName,
    Email: email,
    'Discord ID': discordUserId,
    'Start Date': joinDate,
    Status: 'Active',
    ...(brandValue ? { Brand: brandValue } : {}),
    ...(tierValue ? { 'Package / Tier': tierValue } : {}),
  };
}

// Decides what a join means, given whichever invite the tracker could pin
// down. Pure so the branching - especially the cases that must NOT silently
// grant access - is testable without a live guild.
export function buildJoinPlan({ resolution, inviteRoleMap }) {
  if (!resolution || resolution.reason !== RESOLVED) {
    return {
      invite: null,
      roleNames: [],
      tier: null,
      brand: null,
      flagReason:
        resolution?.reason === AMBIGUOUS
          ? 'Two people joined at once, so the invite used could not be identified.'
          : 'Could not tell which invite link was used (bot restart, vanity URL, or an unmapped link).',
    };
  }

  const invite = resolveInvite(resolution.code, inviteRoleMap);
  if (!invite) {
    return {
      invite: null,
      roleNames: [],
      tier: null,
      brand: null,
      flagReason: `Invite \`${resolution.code}\` is not mapped to a package in DISCORD_INVITE_ROLE_MAP.`,
    };
  }

  return {
    invite,
    roleNames: invite.roleNames,
    tier: invite.tier,
    brand: invite.brand,
    flagReason: null,
  };
}

// The backstop against a forwarded invite link. The invite decided the tier
// at join; if the email they reply with belongs to a client on a different
// package, that is either a shared link or the wrong link sent at checkout -
// either way a human should look, not the bot.
export function detectTierMismatch({ inviteTier, clientRecord }) {
  if (!inviteTier || !clientRecord) return null;
  const recordedValue = clientRecord.fields?.['Package / Tier'];
  const recordedTier = getTierByAirtableValue(
    typeof recordedValue === 'object' ? recordedValue?.name : recordedValue
  );
  if (!recordedTier || recordedTier.key === inviteTier.key) return null;
  return `Joined on the **${inviteTier.name}** link, but their Airtable record says **${recordedTier.name}**. Possible shared link — check before leaving the higher access in place.`;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function registerNewMemberOnboarding({
  discord,
  airtableClient,
  clientGuildId,
  clientSuccessBaseId,
  csmRoleId,
  flagChannelId,
  notionDashboardUrl,
  state,
  saveState,
  inviteTracker = null,
  inviteRoleMap = new Map(),
  log = console,
}) {
  discord.client.on('guildMemberAdd', async (member) => {
    try {
      if (member.guild.id !== clientGuildId) return;

      const displayName = member.displayName ?? member.user.username;
      const resolution = inviteTracker ? await inviteTracker.resolveForJoin() : null;
      const plan = buildJoinPlan({ resolution, inviteRoleMap });

      if (plan.roleNames.length > 0) {
        const { ids, missing } = resolveRoleIdsByName(member.guild, plan.roleNames);
        if (ids.length > 0) await member.roles.add(ids);
        if (missing.length > 0) {
          log.error(`[newMemberOnboarding] roles missing from the guild: ${missing.join(', ')}`);
        }
      }

      // Bible-study members get no private channel - the shared THE CALLED
      // section is their whole surface. Roles alone are the onboarding.
      if (plan.tier && !plan.tier.hasPrivateChannel) {
        log.info(`[newMemberOnboarding] ${displayName} joined as ${plan.tier.name}, no channel`);
        if (flagChannelId && plan.flagReason) {
          await discord.sendToChannel(flagChannelId, `⚠️ <@${member.id}>: ${plan.flagReason}`);
        }
        return;
      }

      // An unresolved invite still gets a channel and a welcome - stranding a
      // paying client outside the server is worse than staff assigning a tier
      // by hand. It just gets the safe fallback: CSM only, no tier role, and
      // a flag. It never guesses upward.
      const staffRoleNames = plan.tier?.staffRoleNames ?? [];
      const { ids: staffRoleIds } = staffRoleNames.length
        ? resolveRoleIdsByName(member.guild, staffRoleNames)
        : { ids: [csmRoleId].filter(Boolean) };

      const parentCategory = plan.tier
        ? findCategoryByName(member.guild.channels.cache.values(), plan.tier.categoryName)
        : null;

      const channel = await discord.createPrivateChannel(member.guild.id, {
        name: slugifyChannelName(displayName),
        overwrites: buildClientChannelOverwrites({
          guildId: member.guild.id,
          memberId: member.id,
          botUserId: discord.client.user.id,
          staffRoleIds,
        }),
        parent: parentCategory?.id,
      });

      await channel.send(
        formatWelcomeMessage({ memberMention: `<@${member.id}>`, notionDashboardUrl })
      );

      state[PENDING_STATE_KEY] = state[PENDING_STATE_KEY] ?? {};
      state[PENDING_STATE_KEY][channel.id] = {
        discordUserId: member.id,
        displayName,
        tierKey: plan.tier?.key ?? null,
        brandValue: plan.brand?.airtableValue ?? null,
        tierValue: plan.tier?.airtableValue ?? null,
      };
      await saveState(state);

      if (flagChannelId && (plan.flagReason || !parentCategory)) {
        const reasons = [
          plan.flagReason,
          plan.tier && !parentCategory
            ? `Category "${plan.tier.categoryName}" not found, so the channel has no parent.`
            : null,
        ].filter(Boolean);
        await discord.sendToChannel(
          flagChannelId,
          `⚠️ <@${member.id}> — ${reasons.join(' ')} Channel: <#${channel.id}>. Assign the right roles by hand.`
        );
      }

      log.info(
        `[newMemberOnboarding] created #${channel.name} for ${member.id} (${plan.tier?.name ?? 'no tier'})`
      );
    } catch (err) {
      log.error('[newMemberOnboarding] guildMemberAdd handler failed:', err);
    }
  });

  discord.client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;

      const pending = state[PENDING_STATE_KEY]?.[message.channel.id];
      if (!pending || pending.discordUserId !== message.author.id) return;

      if (!looksLikeEmail(message.content)) {
        await message.channel.send(
          "That doesn't look like an email — reply with the email address you purchased with."
        );
        return;
      }

      const normalizedEmail = normalizeEmail(message.content);
      const client = await findClientByEmail(airtableClient, clientSuccessBaseId, message.content);

      if (client) {
        await airtableClient.updateRecord(clientSuccessBaseId, CLIENTS_TABLE_ID, client.id, {
          'Discord ID': message.author.id,
        });
        await message.channel.send("You're all set! ✅ Welcome aboard.");

        const mismatch = detectTierMismatch({
          inviteTier: getTierByKey(pending.tierKey),
          clientRecord: client,
        });
        if (mismatch && flagChannelId) {
          await discord.sendToChannel(
            flagChannelId,
            `🚩 <@${message.author.id}> (\`${normalizedEmail}\`) — ${mismatch} Channel: <#${message.channel.id}>`
          );
        }

        log.info(`[newMemberOnboarding] matched ${message.author.id} to client ${client.id}`);
      } else {
        const newClient = await airtableClient.createRecord(
          clientSuccessBaseId,
          CLIENTS_TABLE_ID,
          buildNewClientFields({
            displayName: pending.displayName,
            email: normalizedEmail,
            discordUserId: message.author.id,
            joinDate: todayDateString(),
            brandValue: pending.brandValue,
            tierValue: pending.tierValue,
          })
        );
        await message.channel.send("You're all set! ✅ Welcome aboard.");
        const stillNeeded = pending.tierValue
          ? 'Please fill in CSM and Contract Value.'
          : 'Please review and fill in Package/CSM/Contract details.';
        await discord.sendToChannel(
          flagChannelId,
          `🆕 Created a new Client record for <@${message.author.id}> (\`${normalizedEmail}\`) — no existing match, so this is a starter record. ${stillNeeded} Channel: <#${message.channel.id}>`
        );
        log.info(`[newMemberOnboarding] created client ${newClient.id} for ${message.author.id}`);
      }

      delete state[PENDING_STATE_KEY][message.channel.id];
      await saveState(state);
    } catch (err) {
      log.error('[newMemberOnboarding] messageCreate handler failed:', err);
    }
  });
}
