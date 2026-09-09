// One-time / on-demand admin utility — NOT part of the always-on server.
//
// DRY RUN ONLY. Fetches active Clients, works out who would get a Weekly
// Check-in reminder DM and who'd be skipped (no Discord ID on file), and
// posts that summary to a test channel you control. There is no code path
// in this script that sends a real DM — safe to run as many times as you
// want while automation #3 is still being built out and tested.
//
// Usage:
//   DISCORD_BOT_TOKEN=... AIRTABLE_PAT=... DISCORD_TEST_CHANNEL_ID=... \
//     node scripts/run-weekly-checkin-reminder-dry-run.js
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { createAirtableClient } from '../src/airtableClient.js';
import {
  CLIENTS_TABLE_ID,
  ACTIVE_CLIENTS_FORMULA,
  buildReminderPlan,
  formatDryRunSummary,
} from '../src/reminders/weeklyCheckinReminder.js';

const botToken = process.env.DISCORD_BOT_TOKEN;
const airtablePat = process.env.AIRTABLE_PAT;
const testChannelId = process.env.DISCORD_TEST_CHANNEL_ID;
const clientSuccessBaseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';

const missing = ['DISCORD_BOT_TOKEN', 'AIRTABLE_PAT', 'DISCORD_TEST_CHANNEL_ID'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const airtableClient = createAirtableClient(airtablePat);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}. Fetching active clients...`);

  const records = await airtableClient.listRecords(clientSuccessBaseId, CLIENTS_TABLE_ID, {
    filterByFormula: ACTIVE_CLIENTS_FORMULA,
  });

  const plan = buildReminderPlan(records);
  console.log(
    `Would send: ${plan.toSend.length}. Skipped (no Discord ID): ${plan.skipped.length}.`
  );

  const channel = await client.channels.fetch(testChannelId);
  if (!channel || !channel.isTextBased()) {
    console.error(`Channel ${testChannelId} was not found, or isn't a text channel.`);
    process.exit(1);
  }

  await channel.send(formatDryRunSummary(plan));
  console.log('Posted the dry-run summary to the test channel.');

  client.destroy();
  process.exit(0);
});

client.login(botToken);
