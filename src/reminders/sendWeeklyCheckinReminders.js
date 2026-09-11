import { ChannelType } from 'discord.js';
import { CLIENTS_TABLE_ID, ACTIVE_CLIENTS_FORMULA, buildReminderPlan } from './weeklyCheckinReminder.js';
import { pickClientChannel } from '../discord/tierSync.js';
import { TIER_CATEGORY_NAMES } from '../discord/tiers.js';
import { normalizeChannelName } from '../discord/serverStructure.js';

// The real send path - only reachable from src/index.js when
// WEEKLY_REMINDER_ENABLED=true.
//
// Posts into each client's own private channel rather than DMing them. A DM
// lands in an inbox nobody opens and the CSM never sees it; the client's
// channel is where their coaching already happens, it is private to them and
// their CSM, and Noah can tell at a glance who was actually asked. The client
// is mentioned rather than named, so they still get the notification a DM
// would have given them.
//
// Posts a run summary to logChannelId either way, so a channel that couldn't
// be found surfaces somewhere a human will see it rather than failing
// silently.
export async function sendWeeklyCheckinReminders({
  airtableClient,
  discord,
  baseId,
  clientGuildId,
  logChannelId,
  formUrl,
  log = console,
}) {
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: ACTIVE_CLIENTS_FORMULA,
  });

  const plan = buildReminderPlan(records, { formUrl });
  const failures = [];
  const noChannel = [];
  let sentCount = 0;

  const guild = await discord.client.guilds.fetch(clientGuildId);
  await guild.channels.fetch();
  const channels = [...guild.channels.cache.values()].filter(Boolean);

  // Matched the same way everywhere else: normalized past the decorative emoji
  // a live category name carries.
  const tierCategoryIds = channels
    .filter(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        TIER_CATEGORY_NAMES.some(
          (name) => normalizeChannelName(channel.name) === normalizeChannelName(name)
        )
    )
    .map((channel) => channel.id);

  for (const item of plan.toSend) {
    // Found by the client's own permission overwrite, not by channel name -
    // display names go stale and a renamed client would otherwise be skipped.
    const channel = pickClientChannel(channels, item.discordId, tierCategoryIds);
    if (!channel) {
      // Never falls back to a DM. A client with no private channel is a real
      // gap - they are on a tier that should have one, or their channel is
      // outside the tier categories - and quietly DMing them instead would
      // hide exactly the thing worth fixing.
      noChannel.push({ clientName: item.clientName });
      log.warn(`[weeklyCheckinReminder] no private channel found for ${item.clientName}`);
      continue;
    }

    try {
      await discord.sendToChannel(channel.id, item.message);
      sentCount += 1;
      log.info(`[weeklyCheckinReminder] posted for ${item.clientName} in #${channel.name}`);
    } catch (err) {
      failures.push({ clientName: item.clientName, error: err.message });
      log.error(`[weeklyCheckinReminder] failed to post for ${item.clientName}:`, err);
    }
  }

  const noDiscordId = plan.skipped.filter((item) => item.reason === 'no Discord ID on file');
  const optedOut = plan.skipped.filter((item) => item.reason === 'opted out');

  const lines = [
    `📅 **Weekly Check-in reminders posted** — ${sentCount}/${plan.toSend.length} in their own channels.`,
  ];
  if (failures.length > 0) {
    lines.push('', `Failed to post (${failures.length}):`);
    for (const failure of failures) {
      lines.push(`• ${failure.clientName} — ${failure.error}`);
    }
  }
  if (noChannel.length > 0) {
    lines.push('', `No private channel found (${noChannel.length}):`);
    for (const entry of noChannel) {
      lines.push(`• ${entry.clientName}`);
    }
  }
  lines.push(
    '',
    `Skipped: ${noDiscordId.length} no Discord ID on file, ${optedOut.length} opted out.`
  );

  await discord.sendToChannel(logChannelId, lines.join('\n'));

  return { sentCount, failures, noChannel, skipped: plan.skipped };
}
