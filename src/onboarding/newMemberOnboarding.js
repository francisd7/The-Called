import { CLIENTS_TABLE_ID } from '../reminders/weeklyCheckinReminder.js';
import { slugifyChannelName } from './channelName.js';
import { looksLikeEmail, normalizeEmail } from './email.js';
import { formatWelcomeMessage } from './welcomeMessage.js';

const PENDING_STATE_KEY = 'newMemberOnboardingPending';
const PENDING_LINK_STATE_KEY = 'newMemberOnboardingPendingLinks';

// @everyone's role ID is always the guild ID. Deny it, then explicitly allow
// the new member, the bot itself (by user ID, not role - simpler and doesn't
// depend on knowing the bot's auto-created role ID), and the CSM role.
export function buildChannelOverwrites({ guildId, memberId, botUserId, csmRoleId }) {
  const grant = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];
  return [
    { id: guildId, deny: ['ViewChannel'] },
    { id: memberId, allow: grant },
    { id: botUserId, allow: grant },
    { id: csmRoleId, allow: grant },
  ];
}

export async function findClientByEmail(airtableClient, baseId, email) {
  const normalized = normalizeEmail(email).replace(/'/g, "\\'");
  const formula = `LOWER(TRIM({Email})) = '${normalized}'`;
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: formula,
  });
  return records[0] ?? null;
}

// A client record usually doesn't exist in Airtable yet the moment someone
// joins Discord - staff logs the sale by hand, often after the join. So a
// no-match on first reply isn't necessarily wrong data, just early timing.
// Combines every still-pending email into one OR() formula rather than one
// query per pending link.
export function buildPendingEmailMatchFormula(emails) {
  const clauses = emails.map((email) => {
    const normalized = normalizeEmail(email).replace(/'/g, "\\'");
    return `LOWER(TRIM({Email})) = '${normalized}'`;
  });
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return `OR(${clauses.join(', ')})`;
}

// Re-checks every queued "no match yet" email against Airtable, and finishes
// the link for any that now have a matching Client record - so staff only
// ever has to create the record; linking the Discord ID happens on its own
// once that record exists, instead of needing a second manual step.
export async function retryPendingEmailLinks({
  airtableClient,
  discord,
  clientSuccessBaseId,
  state,
  saveState,
  log = console,
}) {
  const pending = state[PENDING_LINK_STATE_KEY] ?? [];
  if (pending.length === 0) return;

  const formula = buildPendingEmailMatchFormula(pending.map((entry) => entry.email));
  const records = await airtableClient.listRecords(clientSuccessBaseId, CLIENTS_TABLE_ID, {
    filterByFormula: formula,
  });

  const stillPending = [];
  for (const entry of pending) {
    const match = records.find((r) => normalizeEmail(r.fields?.Email) === entry.email);
    if (!match) {
      stillPending.push(entry);
      continue;
    }

    await airtableClient.updateRecord(clientSuccessBaseId, CLIENTS_TABLE_ID, match.id, {
      'Discord ID': entry.discordUserId,
    });
    log.info(`[newMemberOnboarding] resolved pending link for ${entry.discordUserId} -> client ${match.id}`);

    try {
      await discord.sendToChannel(
        entry.channelId,
        `<@${entry.discordUserId}> good news — we found your account and got you linked up! ✅`
      );
    } catch (err) {
      log.error('[newMemberOnboarding] failed to notify a resolved pending link:', err);
    }
  }

  state[PENDING_LINK_STATE_KEY] = stillPending;
  await saveState(state);
}

// Wires the two Discord event listeners this automation needs. Kept as thin
// orchestration around the pure/testable helpers above and in
// channelName.js / email.js / welcomeMessage.js - discord.js objects
// themselves aren't unit tested here, matching how the rest of this hub
// handles the Discord SDK boundary.
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
  log = console,
}) {
  discord.client.on('guildMemberAdd', async (member) => {
    try {
      if (member.guild.id !== clientGuildId) return;

      const channelName = slugifyChannelName(member.displayName ?? member.user.username);
      const overwrites = buildChannelOverwrites({
        guildId: member.guild.id,
        memberId: member.id,
        botUserId: discord.client.user.id,
        csmRoleId,
      });

      const channel = await discord.createPrivateChannel(member.guild.id, {
        name: channelName,
        overwrites,
      });

      const message = formatWelcomeMessage({
        memberMention: `<@${member.id}>`,
        notionDashboardUrl,
      });
      await channel.send(message);

      state[PENDING_STATE_KEY] = state[PENDING_STATE_KEY] ?? {};
      state[PENDING_STATE_KEY][channel.id] = { discordUserId: member.id };
      await saveState(state);

      log.info(`[newMemberOnboarding] created #${channelName} for ${member.id}`);
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

      const client = await findClientByEmail(
        airtableClient,
        clientSuccessBaseId,
        message.content
      );

      if (client) {
        await airtableClient.updateRecord(clientSuccessBaseId, CLIENTS_TABLE_ID, client.id, {
          'Discord ID': message.author.id,
        });
        await message.channel.send("You're all set! ✅ Welcome aboard.");
        log.info(`[newMemberOnboarding] matched ${message.author.id} to client ${client.id}`);
      } else {
        await message.channel.send(
          "I couldn't find that email in our system yet — no worries, a team member will get your account set up and you'll be linked automatically once it's in."
        );
        await discord.sendToChannel(
          flagChannelId,
          `⚠️ New member <@${message.author.id}> replied with an email that didn't match any Client record: \`${normalizeEmail(message.content)}\`. Channel: <#${message.channel.id}>. Once their record is created with this email, they'll be linked automatically — no need to also set their Discord ID by hand.`
        );

        state[PENDING_LINK_STATE_KEY] = state[PENDING_LINK_STATE_KEY] ?? [];
        state[PENDING_LINK_STATE_KEY].push({
          discordUserId: message.author.id,
          email: normalizeEmail(message.content),
          channelId: message.channel.id,
        });

        log.info(`[newMemberOnboarding] no match yet for ${message.author.id}, queued for retry`);
      }

      delete state[PENDING_STATE_KEY][message.channel.id];
      await saveState(state);
    } catch (err) {
      log.error('[newMemberOnboarding] messageCreate handler failed:', err);
    }
  });
}
