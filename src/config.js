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
  // No separate on/off flag: the channel id is the switch. Unset means the
  // automation simply isn't registered, which is one less thing that can be
  // half-configured than a boolean plus an id that disagree with each other.
  discordPostCallChannelId: process.env.DISCORD_POST_CALL_CHANNEL_ID,
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
  // Escape hatch for the one failure the date stamp cannot recover from: a run
  // that marked itself done and then died before sending. The stamp is written
  // BEFORE sending on purpose, so a crashed tick can't double-send - but that
  // same choice means a crashed send is indistinguishable from a finished one,
  // and the week is simply lost. Setting this clears the stamp once at boot.
  weeklyReminderForceRun: process.env.WEEKLY_REMINDER_FORCE_RUN === 'true',
  // The shared Airtable form URL for the Weekly Check-in. One link for
  // everyone; the client's name is prefilled onto it per person. Unset means
  // the reminder still goes out, just without a link - it never produces a
  // sentence ending in a dangling dash.
  weeklyCheckinFormUrl: process.env.WEEKLY_CHECKIN_FORM_URL || '',
  // The accountability half: Saturday's "who ignored Friday's DM" report.
  // Same off-by-default gate, though this one only ever posts to a staff
  // channel - no client ever sees it.
  weeklyReportEnabled: process.env.WEEKLY_REPORT_ENABLED === 'true',
  weeklyReportHourEt: numberOrDefault(process.env.WEEKLY_REPORT_HOUR_ET, 12),
  weeklyReportMinuteEt: numberOrDefault(process.env.WEEKLY_REPORT_MINUTE_ET, 0),
  // 0 on purpose - a new client checks in like everyone else, because their
  // first one is the baseline their CSM reads. Raise it to excuse recent
  // joiners if the report ever gets noisy.
  weeklyReportGraceDays: numberOrDefault(process.env.WEEKLY_REPORT_GRACE_DAYS, 0),
  // Same off-by-default gate as weeklyReminderEnabled - this is the switch
  // between "code exists" and "real Discord channels get created for real
  // new members." Must be explicitly set to the string "true".
  newMemberOnboardingEnabled: process.env.NEW_MEMBER_ONBOARDING_ENABLED === 'true',
  clientGuildId: process.env.DISCORD_CLIENT_GUILD_ID,
  onboardingCsmRoleId: process.env.DISCORD_CSM_ROLE_ID,
  // Where everything the bot needs a human to look at goes: onboarding flags
  // it couldn't resolve, and the tier-change audit log. This lives in the
  // ops server, not the client server - staff work there, clients are here,
  // and splitting bot output across both would mean watching two places.
  // The bot has to be a member of the ops server for these to send.
  opsNotificationsChannelId:
    process.env.DISCORD_OPS_NOTIFICATIONS_CHANNEL_ID || '1547339220840882306',
  notionDashboardUrl: process.env.NOTION_DASHBOARD_URL || '',
  // Maps each package's invite link to the roles it grants, as
  // `code=slotKey,code=slotKey`. Lives in an env var rather than
  // data/state.json on purpose: state.json resets on hosts without a
  // persistent disk, and losing this map would quietly drop every new
  // joiner to no tier at all. `npm run discord-structure` prints the line
  // to paste here after it creates the invites.
  inviteRoleMap: process.env.DISCORD_INVITE_ROLE_MAP || '',
  // Same off-by-default gate as the other two automations. Once true, a tier
  // role change in Discord rewrites Package / Tier in Airtable - so this
  // stays off until the roles themselves are correct.
  tierSyncEnabled: process.env.TIER_SYNC_ENABLED === 'true',
};

// Both of these default to the ops notifications channel. Overridable if the
// audit log ever wants separating from the onboarding flags, but one channel
// is the right default - it is where staff already look.
config.onboardingFlagChannelId =
  process.env.DISCORD_ONBOARDING_FLAG_CHANNEL_ID || config.opsNotificationsChannelId;
// The audit trail for tier writes. Without it a mis-clicked role silently
// rewrites a billing record, so tier sync refuses to start without one.
config.tierChangesChannelId =
  process.env.DISCORD_TIER_CHANGES_CHANNEL_ID || config.opsNotificationsChannelId;

// Defaults to wherever check-in submissions already post, so the "who
// submitted" feed and the "who didn't" report sit together rather than
// splitting one topic across two channels.
config.weeklyReportChannelId =
  process.env.DISCORD_WEEKLY_REPORT_CHANNEL_ID || config.discordWeeklyCheckinChannelId;

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
