import 'dotenv/config';

function numberOrDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  discordBotToken: process.env.DISCORD_BOT_TOKEN,
  discordSetterEodChannelId: process.env.DISCORD_SETTER_EOD_CHANNEL_ID,
  discordWeeklyCheckinChannelId: process.env.DISCORD_WEEKLY_CHECKIN_CHANNEL_ID,
  airtablePat: process.env.AIRTABLE_PAT,
  eodReportsBaseId: process.env.AIRTABLE_EOD_BASE_ID || 'appO76t48mwkC3j80',
  clientSuccessBaseId: process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 60_000,
  stateFilePath: process.env.STATE_FILE_PATH || 'data/state.json',
  // Off by default on purpose - this is the gate between "code exists" and
  // "clients get real DMs." Must be explicitly set to the string "true".
  weeklyReminderEnabled: process.env.WEEKLY_REMINDER_ENABLED === 'true',
  weeklyReminderHourEt: numberOrDefault(process.env.WEEKLY_REMINDER_HOUR_ET, 12),
  weeklyReminderMinuteEt: numberOrDefault(process.env.WEEKLY_REMINDER_MINUTE_ET, 0),
};

export function assertRequiredConfig() {
  const missing = [
    'discordBotToken',
    'discordSetterEodChannelId',
    'discordWeeklyCheckinChannelId',
    'airtablePat',
  ].filter((key) => !config[key]);
  if (missing.length > 0) {
    const envNames = {
      discordBotToken: 'DISCORD_BOT_TOKEN',
      discordSetterEodChannelId: 'DISCORD_SETTER_EOD_CHANNEL_ID',
      discordWeeklyCheckinChannelId: 'DISCORD_WEEKLY_CHECKIN_CHANNEL_ID',
      airtablePat: 'AIRTABLE_PAT',
    };
    throw new Error(
      `Missing required environment variables: ${missing.map((k) => envNames[k]).join(', ')}`
    );
  }
}
