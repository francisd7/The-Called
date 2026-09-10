// One-time / on-demand admin utility — NOT part of the always-on server.
//
// Syncs every channel in the retired category to that category's permissions,
// so retiring a channel actually hides it.
//
// Dragging a channel into a locked category does not hide it. Any channel
// carrying its own overwrites — which every pod channel does, from when
// members were granted access individually — is unsynced, and Discord
// resolves an unsynced channel against its own overwrite list, never its
// category's. So those old personal grants survive the @everyone lockdown and
// the members who hold them still see a "Retired Channels" category with the
// dead channels sitting in it.
//
// Syncing wipes the channel's own overwrites and inherits the category's.
// That is the correct move on a dead channel and the wrong one on a client
// channel, where it would wipe the client's access to their own channel — so
// this refuses to touch anything that looks like an active client's, by name
// or by overwrite, and prints why. A live channel dragged in by mistake is
// the entire reason this isn't done by hand.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/sync-retired-channels.js
//   node scripts/sync-retired-channels.js --apply
//   node scripts/sync-retired-channels.js --category "Retired Channels"
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { createAirtableClient } from '../src/airtableClient.js';
import {
  CLIENTS_TABLE_ID,
  ACTIVE_CLIENTS_FORMULA,
} from '../src/reminders/weeklyCheckinReminder.js';
import { clientsByDiscordId } from '../src/discord/migration.js';
import { planRetiredSync } from '../src/discord/channelMigration.js';
import { normalizeChannelName } from '../src/discord/serverStructure.js';
import { TIER_CATEGORY_NAMES } from '../src/discord/tiers.js';

const apply = process.argv.includes('--apply');
const categoryFlag = process.argv.indexOf('--category');
const categoryName = categoryFlag === -1 ? 'Retired Channels' : process.argv[categoryFlag + 1];

const missing = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_GUILD_ID', 'AIRTABLE_PAT'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const baseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';
const airtableClient = createAirtableClient(process.env.AIRTABLE_PAT);
// GuildMembers only so the plan can name who a channel still grants. A count
// is not reviewable - see the comment where the holders are resolved.
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

  const guild = await client.guilds.fetch(process.env.DISCORD_CLIENT_GUILD_ID);
  await guild.channels.fetch();
  await guild.members.fetch();

  const category = [...guild.channels.cache.values()].find(
    (channel) =>
      channel?.type === ChannelType.GuildCategory &&
      normalizeChannelName(channel.name) === normalizeChannelName(categoryName)
  );
  if (!category) {
    console.error(`No category matching "${categoryName}" — check the name and try again.`);
    client.destroy();
    process.exit(1);
  }
  console.log(`Category: ${category.name}\n`);

  // A client with a channel in one of these has nothing to lose in the
  // retired category. One without might be looking at their only channel.
  const tierCategoryIds = [...guild.channels.cache.values()]
    .filter(
      (channel) =>
        channel?.type === ChannelType.GuildCategory &&
        TIER_CATEGORY_NAMES.some(
          (name) => normalizeChannelName(channel.name) === normalizeChannelName(name)
        )
    )
    .map((channel) => channel.id);

  // Bitfields included: "synced" means the channel's overwrite list is
  // identical to its category's, and syncing copies that list down - so a
  // synced channel still has overwrites and comparing counts alone proves
  // nothing.
  const describe = (channel) => ({
    id: channel.id,
    name: channel.name,
    parentId: channel.parentId ?? null,
    overwrites: [...(channel.permissionOverwrites?.cache?.values() ?? [])].map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type === 1 ? 'member' : 'role',
      allow: String(overwrite.allow.bitfield),
      deny: String(overwrite.deny.bitfield),
    })),
  });

  const plan = planRetiredSync({
    categoryId: category.id,
    categoryOverwrites: describe(category).overwrites,
    tierCategoryIds,
    clients,
    channels: [...guild.channels.cache.values()].filter(Boolean).map(describe),
  });

  console.log(`Already synced (${plan.alreadySynced.length}) — nothing to do.\n`);

  console.log(`To sync (${plan.sync.length}):`);
  for (const channel of plan.sync) {
    // Named, not counted. Every channel carries an overwrite for the bot from
    // grant-bot-channel-access, so "1 personal grant" on an otherwise clean
    // channel reads as a person who won't go away no matter how many you
    // remove by hand - when it is the bot, and syncing is what clears it.
    const holders = channel.overwrites
      .filter((overwrite) => overwrite.type === 'member')
      .map((overwrite) => {
        if (overwrite.id === client.user.id) return 'the bot';
        const member = guild.members.cache.get(overwrite.id);
        return member ? `@${member.displayName}` : `user ${overwrite.id}`;
      });
    const detail = holders.length > 0 ? `still grants ${holders.join(', ')}` : 'differs from category';
    console.log(`  ${`#${channel.name}`.padEnd(32)} ${detail}`);
  }

  if (plan.protected.length > 0) {
    console.log(`\nProtected (${plan.protected.length}) — left alone:`);
    for (const channel of plan.protected) {
      console.log(`  ${`#${channel.name}`.padEnd(32)} ${channel.reason}`);
    }
    console.log(
      '\nThese look like live client channels sitting in the retired category.\n' +
        'Move them back out before syncing anything — a sync would wipe the\n' +
        "client's access to their own channel."
    );
  }

  if (!apply) {
    console.log(`\n${plan.sync.length} channel(s) would be synced. Re-run with --apply.`);
    client.destroy();
    process.exit(0);
  }

  console.log('\nSyncing...');
  let synced = 0;
  let failed = 0;
  for (const entry of plan.sync) {
    try {
      const channel = guild.channels.cache.get(entry.id);
      await channel.lockPermissions();
      synced += 1;
      console.log(`  synced   #${entry.name}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAILED   #${entry.name} — ${err.message}`);
    }
  }

  console.log(`\nDone. Synced: ${synced}, failed: ${failed}.`);
  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
