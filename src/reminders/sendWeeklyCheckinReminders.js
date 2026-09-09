import { CLIENTS_TABLE_ID, ACTIVE_CLIENTS_FORMULA, buildReminderPlan } from './weeklyCheckinReminder.js';

// The real send path - only reachable from src/index.js when
// WEEKLY_REMINDER_ENABLED=true. Posts a run summary to logChannelId either
// way, so a failed DM (closed DMs, client left the server, etc.) surfaces
// somewhere a human will see it rather than failing silently.
export async function sendWeeklyCheckinReminders({
  airtableClient,
  discord,
  baseId,
  logChannelId,
  log = console,
}) {
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: ACTIVE_CLIENTS_FORMULA,
  });

  const plan = buildReminderPlan(records);
  const failures = [];
  let sentCount = 0;

  for (const item of plan.toSend) {
    try {
      await discord.sendDM(item.discordId, item.message);
      sentCount += 1;
      log.info(`[weeklyCheckinReminder] sent to ${item.clientName}`);
    } catch (err) {
      failures.push({ clientName: item.clientName, error: err.message });
      log.error(`[weeklyCheckinReminder] failed to DM ${item.clientName}:`, err);
    }
  }

  const noDiscordId = plan.skipped.filter((item) => item.reason === 'no Discord ID on file');
  const optedOut = plan.skipped.filter((item) => item.reason === 'opted out');

  const lines = [
    `📅 **Weekly Check-in reminders sent** — ${sentCount}/${plan.toSend.length} delivered.`,
  ];
  if (failures.length > 0) {
    lines.push('', `Failed to deliver (${failures.length}):`);
    for (const failure of failures) {
      lines.push(`• ${failure.clientName} — ${failure.error}`);
    }
  }
  lines.push(
    '',
    `Skipped: ${noDiscordId.length} no Discord ID on file, ${optedOut.length} opted out.`
  );

  await discord.sendToChannel(logChannelId, lines.join('\n'));

  return { sentCount, failures, skipped: plan.skipped };
}
