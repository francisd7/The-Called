// One-time admin utility — NOT part of the always-on server.
//
// Moves every active client's private channel into their tier's category and
// rewrites its permission overwrites to that tier's staff list. This is the
// last step of the restructure and the one that actually fixes the original
// problem: 19 private channels in a flat list where nobody could tell which
// were Andrew's and Nigel's.
//
// Doing this by hand is roughly 100 operations AND would not work. Dragging a
// channel into MOMENTUM changes nothing about who can see it — a private
// client channel is unsynced from its category by definition (it carries the
// client's own overwrite), and Discord resolves an unsynced channel against
// its own overwrite list only. The permissions have to be rewritten, which is
// what this does.
//
// DRY RUN BY DEFAULT. Read the plan first. It rewrites the overwrite list
// outright, so the dry run prints what each rewrite would drop — check those
// before applying.
//
// Never touches a channel it isn't sure about: no match, two matches, a
// missing role or a missing category all leave the channel exactly as it is
// and print a line for a human.
//
// Run AFTER scripts/apply-discord-structure.js (the tier categories and staff
// roles have to exist) and AFTER npm run grant-bot-channel-access (the bot
// needs access to a private channel before it can rewrite it).
//
// Usage:
//   node scripts/migrate-client-channels.js            # plan only
//   node scripts/migrate-client-channels.js --apply
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import { createAirtableClient } from '../src/airtableClient.js';
import {
  CLIENTS_TABLE_ID,
  ACTIVE_CLIENTS_FORMULA,
} from '../src/reminders/weeklyCheckinReminder.js';
import { clientsByDiscordId } from '../src/discord/migration.js';
import { planClientChannelMoves, formatChannelPlan } from '../src/discord/channelMigration.js';
import { buildClientChannelOverwrites } from '../src/discord/clientChannel.js';
import { CATEGORIES, normalizeChannelName } from '../src/discord/serverStructure.js';

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

const GRANT =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory;

// A move is skippable only if the live channel is already exactly what the
// rewrite would produce: right parent, every intended overwrite present with
// the right bits, and nothing extra. Anything less and it gets rewritten —
// a partial match is what the pre-restructure channels all look like.
function alreadyCorrect(channel, move) {
  if (!move.parentAlreadyCorrect) return false;
  if (move.droppedOverwrites.length > 0) return false;
  for (const id of move.desiredIds) {
    const existing = channel.permissionOverwrites.cache.get(id);
    if (!existing) return false;
    if (id === channel.guild.id) {
      if (!existing.deny.has(PermissionFlagsBits.ViewChannel)) return false;
    } else if ((existing.allow.bitfield & GRANT) !== GRANT) {
      return false;
    }
  }
  return true;
}

const airtableClient = createAirtableClient(airtablePat);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
  await guild.channels.fetch();

  const roleIdByName = new Map(
    [...guild.roles.cache.values()].map((role) => [role.name, role.id])
  );

  const liveChannels = [...guild.channels.cache.values()].filter(Boolean);
  const categories = liveChannels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const categoryNameById = new Map(categories.map((channel) => [channel.id, channel.name]));

  // Same normalized matching the apply script uses — live names carry emoji
  // and separators, so an exact match would find nothing and every declared
  // channel would look undeclared, which here means eligible to be rewritten.
  const findCategory = (name) =>
    categories.find((channel) => normalizeChannelName(channel.name) === normalizeChannelName(name));

  const categoryIdByName = new Map();
  for (const category of CATEGORIES) {
    const live = findCategory(category.name);
    if (live) categoryIdByName.set(category.name, live.id);
  }

  // Every channel serverStructure.js owns. This is the guard that stops a
  // client's grant on a shared channel from being mistaken for their private
  // one, so it is built before anything is matched.
  const declaredChannelIds = new Set(categories.map((channel) => channel.id));
  for (const category of CATEGORIES) {
    const parentId = categoryIdByName.get(category.name);
    if (!parentId) continue;
    for (const spec of category.channels) {
      const live = liveChannels.find(
        (channel) =>
          channel.parentId === parentId &&
          normalizeChannelName(channel.name) === normalizeChannelName(spec.name)
      );
      if (live) declaredChannelIds.add(live.id);
    }
  }
  console.log(`${declaredChannelIds.size} channels belong to the declared structure — skipped.\n`);

  const plan = planClientChannelMoves({
    clients,
    channels: liveChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      parentId: channel.parentId ?? null,
      isText: channel.type === ChannelType.GuildText,
      overwrites: [...(channel.permissionOverwrites?.cache?.values() ?? [])].map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type === 1 ? 'member' : 'role',
      })),
    })),
    declaredChannelIds,
    categoryIdByName,
    roleIdByName,
    guildId: guild.id,
    botUserId: client.user.id,
  });

  console.log(formatChannelPlan(plan, { categoryNameById }));

  // Named rather than left as raw IDs: "drops 2 overwrite(s)" is only
  // reviewable if you can see it is a stale pod role and not the CSM who has
  // been in that channel for six months.
  const withDrops = plan.moves.filter((move) => move.droppedOverwrites.length > 0);
  if (withDrops.length > 0) {
    console.log('\nOverwrites the rewrite would remove:');
    for (const move of withDrops) {
      const named = move.droppedOverwrites.map((overwrite) => {
        if (overwrite.type === 'member') {
          const member = guild.members.cache.get(overwrite.id);
          return `@${member?.displayName ?? `user ${overwrite.id}`}`;
        }
        const role = guild.roles.cache.get(overwrite.id);
        return role ? `role ${role.name}` : `role ${overwrite.id}`;
      });
      console.log(`  #${move.channelName.padEnd(28)} ${named.join(', ')}`);
    }
    console.log(
      '\nAnyone listed there who also holds one of the tier staff roles keeps\n' +
        'access through the role. Anyone who does not loses it — check before applying.'
    );
  }

  if (!apply) {
    console.log('\nRe-run with --apply to move them.');
    client.destroy();
    process.exit(0);
  }

  console.log('\nMoving...');
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const move of plan.moves) {
    const channel = guild.channels.cache.get(move.channelId);
    if (!channel) {
      console.log(`  FAILED    #${move.channelName} — channel disappeared mid-run.`);
      failed += 1;
      continue;
    }
    if (alreadyCorrect(channel, move)) {
      skipped += 1;
      continue;
    }

    try {
      // lockPermissions:false is load-bearing. Syncing to the category would
      // wipe the client's own overwrite and lock them out of their channel.
      if (!move.parentAlreadyCorrect) {
        await channel.setParent(move.toCategoryId, {
          lockPermissions: false,
          reason: 'The Called Discord restructure',
        });
      }
      // set(), not edit(). The whole point is to replace whatever grew on
      // these channels over time with the tier's exact staff list — edit()
      // would merge and leave the old grants in place.
      await channel.permissionOverwrites.set(
        buildClientChannelOverwrites({
          guildId: guild.id,
          memberId: move.memberId,
          botUserId: client.user.id,
          staffRoleIds: move.staffRoleIds,
        }),
        'The Called Discord restructure'
      );
      moved += 1;
      console.log(`  ${`#${move.channelName}`.padEnd(30)} -> ${move.toCategoryName}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAILED    #${move.channelName} — ${err.message}`);
    }
  }

  console.log(`\nDone. Moved: ${moved}, already correct: ${skipped}, failed: ${failed}.`);
  if (failed > 0) {
    console.log(
      '\nMissing Permissions here means the bot cannot write an overwrite on that\n' +
        'channel. Give its role Administrator temporarily, re-run, then remove it —\n' +
        'the same pattern grant-bot-channel-access.js documents.'
    );
  }
  if (plan.problems.length > 0) {
    console.log(`${plan.problems.length} client(s) still need a human — see the list above.`);
  }

  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(botToken);
