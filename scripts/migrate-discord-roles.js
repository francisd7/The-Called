// One-time admin utility — NOT part of the always-on server.
//
// Gets everyone already in the client server onto the new roles: brand + tier
// for anyone matched in Airtable, `Veteran` for anyone holding a legacy client
// role who isn't. This is the ONLY time Airtable seeds Discord — after it the
// direction reverses permanently and tierSync writes Discord -> Airtable.
//
// DRY RUN BY DEFAULT. Prints the full plan and changes nothing unless you
// pass --apply. Read it first: this decides who keeps the paid areas.
//
// Additive only — it never removes a role, including the legacy brand ones.
// They gate nothing after the restructure, so leaving them costs a stale
// badge; removing the wrong one silently strips access with no record of
// what was there.
//
// Run this AFTER scripts/apply-discord-structure.js, or the tier roles it
// wants to assign won't exist yet.
//
// Usage:
//   node scripts/migrate-discord-roles.js            # plan only
//   node scripts/migrate-discord-roles.js --apply
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { createAirtableClient } from '../src/airtableClient.js';
import {
  CLIENTS_TABLE_ID,
  ACTIVE_CLIENTS_FORMULA,
} from '../src/reminders/weeklyCheckinReminder.js';
import {
  clientsByDiscordId,
  planRoleAssignments,
  formatPlanSummary,
} from '../src/discord/migration.js';
import { resolveRoleIdsByName } from '../src/discord/clientChannel.js';

const apply = process.argv.includes('--apply');

const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_CLIENT_GUILD_ID;
const airtablePat = process.env.AIRTABLE_PAT;
const baseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';

const missing = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_GUILD_ID', 'AIRTABLE_PAT'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const airtableClient = createAirtableClient(airtablePat);
// GuildMembers is privileged — it must be on in the Developer Portal, same
// toggle new-member onboarding already needs.
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
  console.log(`${records.length} active clients in Airtable, ${clients.size} with a Discord ID.\n`);

  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  const guildMembers = await guild.members.fetch();

  const members = [...guildMembers.values()].map((member) => ({
    id: member.id,
    displayName: member.displayName ?? member.user.username,
    bot: member.user.bot,
    roleNames: [...member.roles.cache.values()].map((role) => role.name),
  }));

  const plan = planRoleAssignments({ members, clients });
  console.log(formatPlanSummary(plan));

  if (!apply) {
    console.log('\nRe-run with --apply to assign these roles.');
    client.destroy();
    process.exit(0);
  }

  console.log('\nAssigning...');
  let assigned = 0;
  let failed = 0;

  for (const entry of [...plan.clients, ...plan.veterans]) {
    if (entry.add.length === 0) continue;
    const { ids, missing: missingRoles } = resolveRoleIdsByName(guild, entry.add);
    if (missingRoles.length > 0) {
      console.log(`  MISSING ROLE  ${entry.displayName}: ${missingRoles.join(', ')}`);
      failed += 1;
      continue;
    }
    try {
      const member = guildMembers.get(entry.id);
      await member.roles.add(ids, 'The Called Discord restructure');
      assigned += 1;
      console.log(`  ${entry.displayName.padEnd(24)} + ${entry.add.join(', ')}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAILED  ${entry.displayName}: ${err.message}`);
    }
  }

  console.log(`\nDone. Assigned: ${assigned}, failed: ${failed}.`);
  if (failed > 0) {
    console.log(
      "A failure here usually means the bot's role sits below the role it is " +
        'trying to assign. Move it up in Server Settings → Roles.'
    );
  }

  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(botToken);
