// On-demand admin utility — NOT part of the always-on server.
//
// Catches tier changes that tier sync missed. It listens on guildMemberUpdate
// and nothing else: if the bot is down or mid-deploy when someone clicks a
// tier role, that event is gone — no retry, no queue — and Airtable silently
// stops matching Discord. That happened on 2026-09-10 during a redeploy, and
// nothing surfaced it; the mismatch was found by reading the table for an
// unrelated reason. Silent is the problem, not rare.
//
// Run it after a deploy, or monthly.
//
// It only ever writes Airtable. Discord is the source of truth for tier — it
// is what actually gates access — so a disagreement is always Airtable being
// wrong, never a reason to change someone's roles. It also never blanks
// Package / Tier: someone holding no tier role is reported, not erased, for
// the same reason tierSync leaves a removal alone.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/reconcile-tiers.js            # plan only
//   node scripts/reconcile-tiers.js --apply
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { createAirtableClient } from '../src/airtableClient.js';
import {
  CLIENTS_TABLE_ID,
  ACTIVE_CLIENTS_FORMULA,
} from '../src/reminders/weeklyCheckinReminder.js';
import { clientsByDiscordId } from '../src/discord/migration.js';
import { planTierReconciliation, formatReconciliation } from '../src/discord/tierReconcile.js';

const apply = process.argv.includes('--apply');

const missing = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_GUILD_ID', 'AIRTABLE_PAT'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const baseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';
const airtableClient = createAirtableClient(process.env.AIRTABLE_PAT);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  console.log(apply ? '\nAPPLYING CHANGES\n' : '\nDRY RUN — nothing will be written\n');

  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: ACTIVE_CLIENTS_FORMULA,
  });
  const clients = clientsByDiscordId(records);

  const recordIdByDiscordId = new Map();
  for (const record of records) {
    const id = String(record.fields?.['Discord ID'] ?? '').trim();
    if (id) recordIdByDiscordId.set(id, record.id);
  }

  const guild = await client.guilds.fetch(process.env.DISCORD_CLIENT_GUILD_ID);
  await guild.roles.fetch();
  const guildMembers = await guild.members.fetch();

  const plan = planTierReconciliation({
    clients,
    recordIdByDiscordId,
    members: [...guildMembers.values()].map((member) => ({
      id: member.id,
      displayName: member.displayName ?? member.user.username,
      bot: member.user.bot,
      roleNames: [...member.roles.cache.values()].map((role) => role.name),
    })),
  });

  console.log(formatReconciliation(plan));

  if (!apply) {
    console.log(`\n${plan.writes.length} record(s) would be updated. Re-run with --apply.`);
    client.destroy();
    process.exit(0);
  }

  console.log('\nWriting...');
  let written = 0;
  let failed = 0;
  for (const write of plan.writes) {
    if (!write.recordId) {
      console.log(`  FAILED   ${write.clientName} — no Airtable record id resolved.`);
      failed += 1;
      continue;
    }
    try {
      await airtableClient.updateRecord(baseId, CLIENTS_TABLE_ID, write.recordId, {
        'Package / Tier': write.airtableValue,
      });
      written += 1;
      console.log(`  ${write.clientName.padEnd(24)} -> ${write.to}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAILED   ${write.clientName} — ${err.message}`);
    }
  }

  console.log(`\nDone. Updated: ${written}, failed: ${failed}.`);
  if (plan.writes.some((write) => write.needsChannelMove)) {
    // A change that skipped tierSync skipped the channel move too, so the
    // channel is still under the old tier's category with the old staff on
    // it. That script already does exactly this job, driven from the Airtable
    // values this run just corrected - so run it second, not first.
    console.log(
      '\nSome of those tiers have private channels, which will still be under\n' +
        'their old category with the old staff on them. Run this next:\n' +
        '  npm run discord-migrate-channels'
    );
  }

  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
