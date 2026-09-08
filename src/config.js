import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  discordBotToken: process.env.DISCORD_BOT_TOKEN,
  discordTeamChannelId: process.env.DISCORD_TEAM_CHANNEL_ID,
  airtablePat: process.env.AIRTABLE_PAT,
  eodReportsBaseId: process.env.AIRTABLE_EOD_BASE_ID || 'appO76t48mwkC3j80',
  clientSuccessBaseId: process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 60_000,
  stateFilePath: process.env.STATE_FILE_PATH || 'data/state.json',
};

export function assertRequiredConfig() {
  const missing = ['discordBotToken', 'discordTeamChannelId', 'airtablePat'].filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    const envNames = {
      discordBotToken: 'DISCORD_BOT_TOKEN',
      discordTeamChannelId: 'DISCORD_TEAM_CHANNEL_ID',
      airtablePat: 'AIRTABLE_PAT',
    };
    throw new Error(
      `Missing required environment variables: ${missing.map((k) => envNames[k]).join(', ')}`
    );
  }
}
