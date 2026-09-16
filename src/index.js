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
import { createNotionClient } from './notionClient.js';
import { createClientDashboards } from './dashboards/createClientDashboards.js';

const WEEKLY_REMINDER_TIMEZONE = 'America/New_York';
const WEEKLY_REMINDER_WEEKDAY = 'Fri';
const WEEKLY_REMINDER_STATE_KEY = 'weeklyCheckinReminderLastRunDate';

async function main() {
  assertRequiredConfig();

  if (config.newMemberOnboardingEnabled && (!config.clientGuildId || !config.onboardingCsmRoleId)) {
    throw new Error(
      'NEW_MEMBER_ONBOARDING_ENABLED is true but DISCORD_CLIENT_GUILD_ID or DISCORD_CSM_ROLE_ID is missing'
    );
  }

  if (
    config.notionDashboardEnabled &&
    (!config.notionToken || !config.notionDashboardsDatabaseId)
  ) {
    throw new Error(
      'NOTION_DASHBOARD_ENABLED is true but NOTION_TOKEN or NOTION_DASHBOARDS_DATABASE_ID is missing'
    );
  }

  const airtableClient = createAirtableClient(config.airtablePat);
  const notionClient = config.notionDashboardEnabled
    ? createNotionClient(config.notionToken)
    : null;
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

  // Creates a Notion dashboard for every Active client that doesn't have one
  // yet. Driven by the absence of a "Notion Dashboard URL" on the Airtable
  // record rather than a created-time watermark, which means it's idempotent,
  // self-healing after a failed run, and picks up clients who were added
  // before this automation existed.
  let isCreatingDashboards = false;
  async function runClientDashboardCycle() {
    if (isCreatingDashboards) return;
    isCreatingDashboards = true;
    try {
      await createClientDashboards({
        airtableClient,
        notionClient,
        discord,
        baseId: config.clientSuccessBaseId,
        databaseId: config.notionDashboardsDatabaseId,
        templateName: config.notionDashboardTemplateName,
        notifyChannelId: config.dashboardNotifyChannelId,
      });
    } catch (err) {
      console.error('Client dashboard run failed:', err);
    } finally {
      isCreatingDashboards = false;
    }
  }

  if (config.notionDashboardEnabled) {
    setInterval(runClientDashboardCycle, config.pollIntervalMs);
    runClientDashboardCycle();
    console.log('Client dashboard automation registered.');
  }

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

main().catch((err) => {
  console.error('Fatal error starting automation hub:', err);
  process.exit(1);
});
