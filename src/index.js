import { GatewayIntentBits } from 'discord.js';
import express from 'express';
import { config, assertRequiredConfig } from './config.js';
import { createAirtableClient } from './airtableClient.js';
import { createDiscordClient } from './discordClient.js';
import { createPoller } from './poller.js';
import { loadState, saveState as persistState } from './state.js';
import * as setterEod from './automations/setterEod.js';
import * as weeklyCheckin from './automations/weeklyCheckin.js';
import { isTargetMinute, getLocalDateString, BUSINESS_TIMEZONE } from './reminders/schedule.js';
import { sendWeeklyCheckinReminders } from './reminders/sendWeeklyCheckinReminders.js';
import { sendWeeklyCheckinReport } from './reminders/sendWeeklyCheckinReport.js';
import { registerNewMemberOnboarding } from './onboarding/newMemberOnboarding.js';
import { createInviteTracker } from './discord/inviteTracker.js';
import { parseInviteRoleMap, findUnmappedSlots, getInviteSlot } from './discord/inviteRoles.js';
import { registerTierSync } from './discord/tierSync.js';

const WEEKLY_REMINDER_WEEKDAY = 'Fri';
const WEEKLY_REMINDER_STATE_KEY = 'weeklyCheckinReminderLastRunDate';

// The day after the reminder, so clients have had a full day to act on it.
const WEEKLY_REPORT_WEEKDAY = 'Sat';
const WEEKLY_REPORT_STATE_KEY = 'weeklyCheckinReportLastRunDate';

async function main() {
  assertRequiredConfig();

  if (config.newMemberOnboardingEnabled && (!config.clientGuildId || !config.onboardingCsmRoleId)) {
    throw new Error(
      'NEW_MEMBER_ONBOARDING_ENABLED is true but DISCORD_CLIENT_GUILD_ID or DISCORD_CSM_ROLE_ID is missing'
    );
  }

  // Tier sync rewrites a billing field in Airtable off a Discord role click,
  // so it refuses to start without somewhere to log those writes - an
  // unlogged mis-click is exactly the failure this design has to avoid.
  if (config.tierSyncEnabled && (!config.clientGuildId || !config.tierChangesChannelId)) {
    throw new Error(
      'TIER_SYNC_ENABLED is true but DISCORD_CLIENT_GUILD_ID or DISCORD_TIER_CHANGES_CHANNEL_ID is missing'
    );
  }

  const airtableClient = createAirtableClient(config.airtablePat);
  // GuildMembers/MessageContent are privileged intents - only request them
  // once a feature that needs them is enabled, so this never breaks login
  // for the rest of the hub before those portal toggles are turned on.
  // GuildInvites is not privileged, but it's only useful alongside them.
  const needsMemberEvents = config.newMemberOnboardingEnabled || config.tierSyncEnabled;
  const extraIntents = needsMemberEvents
    ? [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites,
      ]
    : [];
  const discord = createDiscordClient(config.discordBotToken, { extraIntents });

  const state = await loadState(config.stateFilePath);
  const saveState = (s) => persistState(config.stateFilePath, s);

  const poller = createPoller({ airtableClient, discord, state, saveState });

  const automations = [
    {
      key: setterEod.key,
      baseId: config.eodReportsBaseId,
      tableId: setterEod.tableId,
      formatMessage: setterEod.formatMessage,
      discordChannelId: config.discordSetterEodChannelId,
    },
    {
      key: weeklyCheckin.key,
      baseId: config.clientSuccessBaseId,
      tableId: weeklyCheckin.tableId,
      formatMessage: weeklyCheckin.formatMessage,
      discordChannelId: config.discordWeeklyCheckinChannelId,
    },
  ];

  await discord.ready;
  console.log(`Discord bot logged in as ${discord.client.user.tag}`);

  let isPolling = false;
  async function runPollCycle() {
    if (isPolling) return;
    isPolling = true;
    try {
      await poller.pollAll(automations);
    } finally {
      isPolling = false;
    }
  }
  setInterval(runPollCycle, config.pollIntervalMs);
  runPollCycle();

  let isCheckingReminderSchedule = false;
  async function runWeeklyReminderCheckCycle() {
    if (!config.weeklyReminderEnabled || isCheckingReminderSchedule) return;
    isCheckingReminderSchedule = true;
    try {
      const now = new Date();
      const todayEt = getLocalDateString(now, BUSINESS_TIMEZONE);
      if (state[WEEKLY_REMINDER_STATE_KEY] === todayEt) return;

      const isFireTime = isTargetMinute(now, {
        weekday: WEEKLY_REMINDER_WEEKDAY,
        hour: config.weeklyReminderHourEt,
        minute: config.weeklyReminderMinuteEt,
        timeZone: BUSINESS_TIMEZONE,
      });
      if (!isFireTime) return;

      // Mark as run before sending, so an overlapping tick mid-send (or a
      // send that takes over a minute) can't double-fire in the same minute.
      state[WEEKLY_REMINDER_STATE_KEY] = todayEt;
      await saveState(state);

      console.log('Running Weekly Check-in reminder send...');
      await sendWeeklyCheckinReminders({
        airtableClient,
        discord,
        baseId: config.clientSuccessBaseId,
        logChannelId: config.discordWeeklyCheckinChannelId,
      });
      console.log('Weekly Check-in reminder send complete.');
    } catch (err) {
      console.error('Weekly Check-in reminder run failed:', err);
    } finally {
      isCheckingReminderSchedule = false;
    }
  }
  setInterval(runWeeklyReminderCheckCycle, 60_000);

  // Same shape as the reminder cycle above, deliberately: one date-stamped
  // state key so a tick that overlaps a slow run can't post the report twice
  // into a staff channel.
  let isCheckingReportSchedule = false;
  async function runWeeklyReportCheckCycle() {
    if (!config.weeklyReportEnabled || isCheckingReportSchedule) return;
    isCheckingReportSchedule = true;
    try {
      const now = new Date();
      const todayEt = getLocalDateString(now, BUSINESS_TIMEZONE);
      if (state[WEEKLY_REPORT_STATE_KEY] === todayEt) return;

      const isFireTime = isTargetMinute(now, {
        weekday: WEEKLY_REPORT_WEEKDAY,
        hour: config.weeklyReportHourEt,
        minute: config.weeklyReportMinuteEt,
        timeZone: BUSINESS_TIMEZONE,
      });
      if (!isFireTime) return;

      state[WEEKLY_REPORT_STATE_KEY] = todayEt;
      await saveState(state);

      console.log('Running Weekly Check-in missing report...');
      await sendWeeklyCheckinReport({
        airtableClient,
        discord,
        baseId: config.clientSuccessBaseId,
        channelId: config.weeklyReportChannelId,
        graceDays: config.weeklyReportGraceDays,
        now,
        timeZone: BUSINESS_TIMEZONE,
      });
      console.log('Weekly Check-in missing report complete.');
    } catch (err) {
      console.error('Weekly Check-in missing report failed:', err);
    } finally {
      isCheckingReportSchedule = false;
    }
  }
  setInterval(runWeeklyReportCheckCycle, 60_000);

  if (config.newMemberOnboardingEnabled) {
    const { map: inviteRoleMap, unknownSlots } = parseInviteRoleMap(config.inviteRoleMap);
    if (unknownSlots.length > 0) {
      console.warn(
        `DISCORD_INVITE_ROLE_MAP has entries that don't parse: ${unknownSlots.join(', ')}`
      );
    }
    // A package with no mapped invite silently lands every buyer of it with
    // no tier at all, so say so at boot rather than let a client find out.
    const unmapped = findUnmappedSlots(inviteRoleMap);
    if (unmapped.length > 0) {
      console.warn(
        `No invite link mapped for: ${unmapped.map((key) => getInviteSlot(key).label).join(', ')}. ` +
          'Joins on those packages will be flagged for manual role assignment.'
      );
    } else {
      console.log(`Invite role map loaded for all ${inviteRoleMap.size} package links.`);
    }

    const inviteTracker = createInviteTracker({
      fetchInvites: () => discord.fetchGuildInvites(config.clientGuildId),
    });
    // Primed before any join can be handled: without a baseline every join
    // resolves to "couldn't tell" and gets flagged.
    await inviteTracker.prime();

    registerNewMemberOnboarding({
      discord,
      airtableClient,
      clientGuildId: config.clientGuildId,
      clientSuccessBaseId: config.clientSuccessBaseId,
      csmRoleId: config.onboardingCsmRoleId,
      flagChannelId: config.onboardingFlagChannelId,
      notionDashboardUrl: config.notionDashboardUrl,
      state,
      saveState,
      inviteTracker,
      inviteRoleMap,
    });

    // Discord creates and deletes invites out from under the cache, so keep
    // it fresh rather than only refreshing on a join.
    discord.client.on('inviteCreate', () => inviteTracker.refresh().catch(() => {}));
    discord.client.on('inviteDelete', () => inviteTracker.refresh().catch(() => {}));

    console.log('New-member onboarding automation registered.');
  }

  if (config.tierSyncEnabled) {
    registerTierSync({
      discord,
      airtableClient,
      clientGuildId: config.clientGuildId,
      clientSuccessBaseId: config.clientSuccessBaseId,
      tierChangesChannelId: config.tierChangesChannelId,
    });
    console.log('Tier sync registered (Discord role -> Airtable Package / Tier).');
  }

  const app = express();
  app.get('/', (req, res) => res.send('The Called — Automation Hub is running.'));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    discord.client.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error starting automation hub:', err);
  process.exit(1);
});
