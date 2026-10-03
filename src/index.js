import { GatewayIntentBits } from 'discord.js';
import express from 'express';
import { config, assertRequiredConfig } from './config.js';
import { createAirtableClient } from './airtableClient.js';
import { createDiscordClient } from './discordClient.js';
import { createPoller } from './poller.js';
import { loadState, saveState as persistState } from './state.js';
import * as setterEod from './automations/setterEod.js';
import * as weeklyCheckin from './automations/weeklyCheckin.js';
import { isTargetMinute, getLocalDateString } from './reminders/schedule.js';
import { sendWeeklyCheckinReminders } from './reminders/sendWeeklyCheckinReminders.js';
import { registerNewMemberOnboarding } from './onboarding/newMemberOnboarding.js';
import {
  buildCallAnnouncementSetup,
  findAnnouncementChannelProblem,
  postDueCallAnnouncements,
} from './announcements/weeklyCalls.js';

const WEEKLY_REMINDER_TIMEZONE = 'America/New_York';
const WEEKLY_REMINDER_WEEKDAY = 'Fri';
const WEEKLY_REMINDER_STATE_KEY = 'weeklyCheckinReminderLastRunDate';
const CALL_ANNOUNCEMENTS_STATE_KEY = 'callAnnouncementsLastPosted';

async function main() {
  assertRequiredConfig();

  if (config.newMemberOnboardingEnabled && (!config.clientGuildId || !config.onboardingCsmRoleId)) {
    throw new Error(
      'NEW_MEMBER_ONBOARDING_ENABLED is true but DISCORD_CLIENT_GUILD_ID or DISCORD_CSM_ROLE_ID is missing'
    );
  }

  // A bad announcement setting never takes down the rest of the hub - the
  // announcements just stay off, and staff get told why in the flag channel
  // once Discord is connected (see below).
  let callAnnouncements = null;
  let callAnnouncementConfigError = null;
  if (config.callAnnouncementsEnabled) {
    try {
      callAnnouncements = buildCallAnnouncementSetup(config);
    } catch (err) {
      callAnnouncementConfigError = err;
    }
  }

  const airtableClient = createAirtableClient(config.airtablePat);
  // GuildMembers/MessageContent are privileged intents - only request them
  // once onboarding is actually enabled, so this never breaks login for the
  // rest of the hub before those portal toggles are turned on.
  const extraIntents = config.newMemberOnboardingEnabled
    ? [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
      const todayEt = getLocalDateString(now, WEEKLY_REMINDER_TIMEZONE);
      if (state[WEEKLY_REMINDER_STATE_KEY] === todayEt) return;

      const isFireTime = isTargetMinute(now, {
        weekday: WEEKLY_REMINDER_WEEKDAY,
        hour: config.weeklyReminderHourEt,
        minute: config.weeklyReminderMinuteEt,
        timeZone: WEEKLY_REMINDER_TIMEZONE,
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

  let isCheckingCallAnnouncements = false;
  async function runCallAnnouncementCheckCycle() {
    if (!callAnnouncements || isCheckingCallAnnouncements) return;
    isCheckingCallAnnouncements = true;
    try {
      await postDueCallAnnouncements({
        slots: callAnnouncements.slots,
        state,
        saveState,
        discord,
        channelId: config.announcementsChannelId,
        ping: callAnnouncements.ping,
        stateKey: CALL_ANNOUNCEMENTS_STATE_KEY,
      });
    } catch (err) {
      console.error('Call announcement check failed:', err);
    } finally {
      isCheckingCallAnnouncements = false;
    }
  }
  setInterval(runCallAnnouncementCheckCycle, 60_000);
  reportCallAnnouncementStatus({ discord, callAnnouncements, configError: callAnnouncementConfigError }).catch(
    (err) => console.error('Call announcement status check failed:', err)
  );

  if (config.newMemberOnboardingEnabled) {
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
    });
    console.log('New-member onboarding automation registered.');
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

async function reportCallAnnouncementStatus({ discord, callAnnouncements, configError }) {
  if (!config.callAnnouncementsEnabled) {
    console.log('Call announcements disabled (CALL_ANNOUNCEMENTS_ENABLED is not exactly "true").');
    return;
  }

  let problem = null;
  if (configError) {
    problem = `are **OFF** — ${configError.message}. Fix that variable on Railway and redeploy.`;
  } else {
    const channelProblem = await findAnnouncementChannelProblem({
      discord,
      channelId: config.announcementsChannelId,
      ping: callAnnouncements.ping,
    });
    if (channelProblem) {
      problem = `can't post yet — ${channelProblem}. Fix the channel permissions (no redeploy needed).`;
    }
    console.log(`Call announcements enabled: ${callAnnouncements.slots.map((slot) => slot.key).join(', ')}`);
  }
  if (!problem) return;

  console.error(`Call announcements ${problem}`);
  try {
    await discord.sendToChannel(config.onboardingFlagChannelId, `⚠️ Weekly call announcements ${problem}`);
  } catch (err) {
    console.error('Could not post the call announcement warning:', err);
  }
}

main().catch((err) => {
  console.error('Fatal error starting automation hub:', err);
  process.exit(1);
});
