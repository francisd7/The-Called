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

const WEEKLY_REMINDER_TIMEZONE = 'America/New_York';
const WEEKLY_REMINDER_WEEKDAY = 'Fri';
const WEEKLY_REMINDER_STATE_KEY = 'weeklyCheckinReminderLastRunDate';

async function main() {
  assertRequiredConfig();

  const airtableClient = createAirtableClient(config.airtablePat);
  const discord = createDiscordClient(config.discordBotToken);

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
