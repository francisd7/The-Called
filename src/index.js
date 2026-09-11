import { GatewayIntentBits } from 'discord.js';
import express from 'express';
import { config, assertRequiredConfig } from './config.js';
import { createAirtableClient } from './airtableClient.js';
import { createDiscordClient } from './discordClient.js';
import { createPoller } from './poller.js';
import { loadState, saveState as persistState } from './state.js';
import * as setterEod from './automations/setterEod.js';
import * as weeklyCheckin from './automations/weeklyCheckin.js';
import * as postCall from './automations/postCall.js';
import { isWeeklyJobDue, getLocalDateString, BUSINESS_TIMEZONE } from './reminders/schedule.js';
import { sendWeeklyCheckinReminders } from './reminders/sendWeeklyCheckinReminders.js';
import { sendWeeklyCheckinReport } from './reminders/sendWeeklyCheckinReport.js';
import { registerNewMemberOnboarding } from './onboarding/newMemberOnboarding.js';
import { createInviteTracker } from './discord/inviteTracker.js';
import { parseInviteRoleMap, findUnmappedSlots, getInviteSlot } from './discord/inviteRoles.js';
import { registerTierSync } from './discord/tierSync.js';

const WEEKLY_REMINDER_WEEKDAY = 'Fri';
const WEEKLY_REMINDER_STATE_KEY = 'weeklyCheckinReminderLastRunDate';
// Which clients this week's run has already reached. Recorded per client as
// it goes, so a run that dies part-way resumes rather than losing the rest of
// the week - the failure that went unnoticed on 2026-09-11.
const WEEKLY_REMINDER_PROGRESS_KEY = 'weeklyCheckinReminderProgress';

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

  // The reminder posts into each client's private channel, so it needs to know
  // which guild to look in. Failing at boot beats discovering it as twenty
  // "no private channel found" lines on a Friday afternoon.
  if (config.weeklyReminderEnabled && !config.clientGuildId) {
    throw new Error('WEEKLY_REMINDER_ENABLED is true but DISCORD_CLIENT_GUILD_ID is missing');
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

  if (config.discordPostCallChannelId) {
    automations.push({
      key: postCall.key,
      baseId: config.eodReportsBaseId,
      tableId: postCall.tableId,
      formatMessage: postCall.formatMessage,
      discordChannelId: config.discordPostCallChannelId,
    });
  } else {
    console.log('Post Call posting is off — set DISCORD_POST_CALL_CHANNEL_ID to enable it.');
  }

  // Started BEFORE awaiting Discord, deliberately. Railway decides a deploy is
  // healthy by hitting this server, and on 2026-09-11 a TLS handshake failure
  // against Discord left `ready` pending forever - so listen() was never
  // reached, the healthcheck got nothing, and Railway killed a deploy whose
  // only actual problem was that one connection. The health endpoint must not
  // depend on the thing most likely to be broken.
  const app = express();
  app.get('/', (req, res) => res.send('The Called — Automation Hub is running.'));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  // Everything below needs a live gateway, so it waits. Login retries with
  // backoff in the background; the process stays up and serves health while
  // it does, which is what lets a weekly job catch up once Discord returns.
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
      if (
        !isWeeklyJobDue(now, {
          weekday: WEEKLY_REMINDER_WEEKDAY,
          hour: config.weeklyReminderHourEt,
          minute: config.weeklyReminderMinuteEt,
          timeZone: BUSINESS_TIMEZONE,
          lastRunDate: state[WEEKLY_REMINDER_STATE_KEY],
        })
      ) {
        return;
      }

      // Progress is per client and saved as each post lands, so a crash costs
      // only the client in flight. The "ran today" stamp is written at the
      // END now, not the start: writing it first is what let a crashed run
      // look like a finished one and lose a whole week in silence. A second
      // tick during a slow run is held off by isCheckingReminderSchedule, and
      // across a restart the progress record is what prevents a double-send.
      const progress =
        state[WEEKLY_REMINDER_PROGRESS_KEY]?.date === todayEt
          ? state[WEEKLY_REMINDER_PROGRESS_KEY]
          : { date: todayEt, sent: [] };
      state[WEEKLY_REMINDER_PROGRESS_KEY] = progress;
      await saveState(state);

      console.log('Running Weekly Check-in reminder send...');
      await sendWeeklyCheckinReminders({
        airtableClient,
        discord,
        baseId: config.clientSuccessBaseId,
        clientGuildId: config.clientGuildId,
        logChannelId: config.discordWeeklyCheckinChannelId,
        formUrl: config.weeklyCheckinFormUrl,
        alreadySent: new Set(progress.sent),
        markSent: async (discordId) => {
          progress.sent.push(discordId);
          await saveState(state);
        },
      });

      state[WEEKLY_REMINDER_STATE_KEY] = todayEt;
      await saveState(state);
      console.log('Weekly Check-in reminder send complete.');
    } catch (err) {
      console.error('Weekly Check-in reminder run failed:', err);
      // Said out loud in Discord, not just the console. A run that fails
      // quietly is indistinguishable from one that was never due, which is
      // how a missed week goes unnoticed until someone thinks to ask.
      await discord
        .sendToChannel(
          config.opsNotificationsChannelId,
          `⚠️ **Weekly Check-in reminder run failed** — ${err?.message ?? err}\nIt will retry on the next check and resume where it stopped.`
        )
        .catch(() => {});
    } finally {
      isCheckingReminderSchedule = false;
    }
  }
  setInterval(runWeeklyReminderCheckCycle, 60_000);
  // Said out loud at boot. Neither weekly job announced itself, so the only
  // way to tell "it is switched off" from "it should have fired and didn't"
  // was to wait for the day and then go digging - which is exactly how
  // 2026-09-11 was spent.
  console.log(
    config.weeklyReminderEnabled
      ? `Weekly Check-in reminder armed for ${WEEKLY_REMINDER_WEEKDAY} ${String(
          config.weeklyReminderHourEt
        ).padStart(2, '0')}:${String(config.weeklyReminderMinuteEt).padStart(2, '0')} ET` +
          `${config.weeklyCheckinFormUrl ? '' : ' (no form URL set — the message will have no link)'}`
      : 'Weekly Check-in reminder is off — set WEEKLY_REMINDER_ENABLED=true to arm it.'
  );

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
      if (
        !isWeeklyJobDue(now, {
          weekday: WEEKLY_REPORT_WEEKDAY,
          hour: config.weeklyReportHourEt,
          minute: config.weeklyReportMinuteEt,
          timeZone: BUSINESS_TIMEZONE,
          lastRunDate: state[WEEKLY_REPORT_STATE_KEY],
        })
      ) {
        return;
      }

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
  console.log(
    config.weeklyReportEnabled
      ? `Weekly Check-in missing report armed for ${WEEKLY_REPORT_WEEKDAY} ${String(
          config.weeklyReportHourEt
        ).padStart(2, '0')}:${String(config.weeklyReportMinuteEt).padStart(2, '0')} ET, posting to ${
          config.weeklyReportChannelId
        }`
      : 'Weekly Check-in missing report is off — set WEEKLY_REPORT_ENABLED=true to arm it.'
  );

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

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    discord.client.destroy();
    process.exit(0);
  });
}

// Node exits on an unhandled rejection by default, so one stray failed
// promise anywhere - a rate-limited DM, a socket hiccup inside a library -
// takes down every automation in this process. For an always-on hub that
// trade is backwards: the cost of carrying on is a logged error, the cost of
// exiting is a whole week's reminder never being sent, silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (continuing):', reason);
});

// An uncaught exception is different: the process may be in a state nobody
// reasoned about, so it is logged and handed back to Railway to restart
// cleanly rather than left running in an unknown condition.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, restarting:', err);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal error starting automation hub:', err);
  process.exit(1);
});
