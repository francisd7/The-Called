import { CLIENTS_TABLE_ID } from '../reminders/weeklyCheckinReminder.js';
import { slugifyChannelName } from './channelName.js';
import { looksLikeEmail, normalizeEmail } from './email.js';
import { formatWelcomeMessage } from './welcomeMessage.js';

const PENDING_STATE_KEY = 'newMemberOnboardingPending';

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
          "I couldn't find that email in our system — no worries, a team member will follow up with you here shortly."
        );
        await discord.sendToChannel(
          flagChannelId,
          `⚠️ New member <@${message.author.id}> replied with an email that didn't match any Client record: \`${normalizeEmail(message.content)}\`. Channel: <#${message.channel.id}>`
        );
        log.info(`[newMemberOnboarding] no match for ${message.author.id}, flagged`);
      }

      delete state[PENDING_STATE_KEY][message.channel.id];
      await saveState(state);
    } catch (err) {
      log.error('[newMemberOnboarding] messageCreate handler failed:', err);
    }
  });
}
