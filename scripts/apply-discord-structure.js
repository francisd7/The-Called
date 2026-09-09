// One-time / on-demand admin utility — NOT part of the always-on server.
//
// Reconciles the client server against src/discord/serverStructure.js:
// creates missing roles, categories and channels, and rewrites permission
// overwrites that have drifted. Additive only — it never deletes a role, a
// channel or a category, because a wrong delete here costs real client
// history and there is no undo.
//
// DRY RUN BY DEFAULT. It prints the plan and changes nothing unless you pass
// --apply. Read the plan first: on a server this locked down, a bad
// permission write can hide every channel from every client at once.
//
// Usage:
//   node scripts/apply-discord-structure.js                 # plan only
//   node scripts/apply-discord-structure.js --apply         # actually write
//   node scripts/apply-discord-structure.js --apply --invites
//
// --invites additionally creates one invite per package and prints the
// DISCORD_INVITE_ROLE_MAP line to paste into the host's env vars.
//
// AFTER RUNNING THIS: re-run `npm run grant-bot-channel-access`. Every new
// category needs the bot granted into it explicitly — see docs/STATUS.md for
// the DiscordAPIError[50001] this avoids.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  ROLES,
  CATEGORIES,
  EVERYONE,
  BOT_ROLE_ANCHOR,
  mergeOverwrites,
  resolveChannelOverwrites,
  findUnknownOverwriteRoles,
} from '../src/discord/serverStructure.js';
import { INVITE_SLOTS } from '../src/discord/inviteRoles.js';

const apply = process.argv.includes('--apply');
const withInvites = process.argv.includes('--invites');

const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_CLIENT_GUILD_ID;

const missingEnv = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_GUILD_ID'].filter((n) => !process.env[n]);
if (missingEnv.length > 0) {
  console.error(`Set these first (in your .env file): ${missingEnv.join(', ')}`);
  process.exit(1);
}

// Catches an overwrite naming a role the config never defines, before
// touching Discord — otherwise that grant is silently skipped at apply time
// and a channel ends up more open than intended.
const unknownRoles = findUnknownOverwriteRoles();
if (unknownRoles.length > 0) {
  console.error(`serverStructure.js references roles it never defines: ${unknownRoles.join(', ')}`);
  process.exit(1);
}

let changeCount = 0;
function note(action, detail) {
  changeCount += 1;
  console.log(`  ${action.padEnd(8)} ${detail}`);
}

function bits(names = []) {
  return names.reduce((acc, name) => acc | PermissionFlagsBits[name], 0n);
}

function idFor(roleName, roleIdByName, guild) {
  return roleName === EVERYONE ? guild.id : roleIdByName.get(roleName);
}

// Bitfield form, for creating a channel with its overwrites in one call.
function toCreateOverwrites(specs, roleIdByName, guild) {
  return specs
    .map((spec) => {
      const id = idFor(spec.role, roleIdByName, guild);
      return id ? { id, allow: bits(spec.allow), deny: bits(spec.deny) } : null;
    })
    .filter(Boolean);
}

// Name/boolean form, for editing one role's overwrite in place. Updates go
// through edit() rather than set() on purpose: set() replaces the entire
// overwrite list, which would strip the bot's own grant from
// grant-bot-channel-access (the DiscordAPIError[50001] in docs/STATUS.md)
// and, on a client channel, the client's access to their own channel.
function toEditOptions(spec) {
  const options = {};
  for (const name of spec.allow ?? []) options[name] = true;
  for (const name of spec.deny ?? []) options[name] = false;
  return options;
}

function overwritesMatch(channel, specs, roleIdByName, guild) {
  for (const spec of specs) {
    const id = idFor(spec.role, roleIdByName, guild);
    if (!id) continue;
    const existing = channel.permissionOverwrites.cache.get(id);
    if (!existing) return false;
    if (existing.allow.bitfield !== bits(spec.allow)) return false;
    if (existing.deny.bitfield !== bits(spec.deny)) return false;
  }
  return true;
}

async function applyOverwrites(channel, specs, roleIdByName, guild) {
  for (const spec of specs) {
    const id = idFor(spec.role, roleIdByName, guild);
    if (id) await channel.permissionOverwrites.edit(id, toEditOptions(spec));
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  console.log(apply ? '\nAPPLYING CHANGES\n' : '\nDRY RUN — nothing will be written\n');

  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  await guild.channels.fetch();
  console.log(`Server: ${guild.name}\n`);

  // --- Roles -------------------------------------------------------------
  console.log('Roles:');
  const before = changeCount;
  const roleIdByName = new Map();
  for (const role of ROLES) {
    const existing = guild.roles.cache.find((r) => r.name === role.name);
    if (existing) {
      roleIdByName.set(role.name, existing.id);
      continue;
    }
    note('create', `role "${role.name}"`);
    if (apply) {
      const created = await guild.roles.create({
        name: role.name,
        color: role.color ?? undefined,
        hoist: role.hoist,
        mentionable: role.mentionable,
        reason: 'The Called Discord restructure',
      });
      roleIdByName.set(role.name, created.id);
    }
  }
  if (changeCount === before) console.log('  (all present)');

  // --- Categories and channels -------------------------------------------
  for (const category of CATEGORIES) {
    console.log(`\n${category.name}:`);
    if (category.note) console.log(`  note: ${category.note}`);
    const categoryChanges = changeCount;

    let parent = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === category.name
    );

    if (!parent) {
      note('create', `category "${category.name}"`);
      if (apply) {
        parent = await guild.channels.create({
          name: category.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: toCreateOverwrites(category.overwrites, roleIdByName, guild),
          reason: 'The Called Discord restructure',
        });
      }
    } else if (!overwritesMatch(parent, category.overwrites, roleIdByName, guild)) {
      note('perms', `category "${category.name}"`);
      if (apply) await applyOverwrites(parent, category.overwrites, roleIdByName, guild);
    }

    for (const channelSpec of category.channels) {
      const isVoice = channelSpec.type === 'voice';

      // Self-contained: the channel's own spec layered over the category's,
      // because an unsynced channel inherits nothing at permission-check
      // time. mergeOverwrites lets the channel entry win outright for a role
      // (that is how #wins downgrades the bible-study tier to read-only).
      const specs = mergeOverwrites([
        ...category.overwrites,
        ...resolveChannelOverwrites(channelSpec),
      ]);

      const existing = guild.channels.cache.find(
        (channel) => channel.name === channelSpec.name && channel.parentId === parent?.id
      );

      if (!existing) {
        note('create', `#${channelSpec.name}${isVoice ? ' (voice)' : ''}`);
        if (apply) {
          await guild.channels.create({
            name: channelSpec.name,
            type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
            parent: parent.id,
            permissionOverwrites: toCreateOverwrites(specs, roleIdByName, guild),
            reason: 'The Called Discord restructure',
          });
        }
      } else if (!overwritesMatch(existing, specs, roleIdByName, guild)) {
        note('perms', `#${channelSpec.name}`);
        if (apply) await applyOverwrites(existing, specs, roleIdByName, guild);
      }
    }

    if (changeCount === categoryChanges) console.log('  (up to date)');
  }

  // --- Invites ------------------------------------------------------------
  if (withInvites) {
    console.log('\nInvites:');
    const welcome = guild.channels.cache.find(
      (channel) => channel.name === 'welcome' && channel.type === ChannelType.GuildText
    );
    if (!welcome) {
      console.log('  #welcome not found — create the structure first, then re-run with --invites.');
    } else if (!apply) {
      for (const slot of INVITE_SLOTS) note('create', `invite for ${slot.label}`);
    } else {
      const pairs = [];
      for (const slot of INVITE_SLOTS) {
        const invite = await welcome.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: true,
          reason: `The Called — ${slot.label}`,
        });
        pairs.push(`${invite.code}=${slot.key}`);
        console.log(`  ${slot.label.padEnd(32)} https://discord.gg/${invite.code}`);
      }
      console.log('\nPaste this into DISCORD_INVITE_ROLE_MAP on the host:\n');
      console.log(pairs.join(','));
    }
  }

  // --- Reminders ----------------------------------------------------------
  console.log('\n---');
  if (!apply) {
    console.log(`${changeCount} change(s) would be made. Re-run with --apply to write them.`);
  } else {
    console.log(`${changeCount} change(s) applied.`);
    console.log('\nNext, and do not skip these:');
    console.log('  1. npm run grant-bot-channel-access   (new categories lock the bot out)');
    console.log(`  2. Drag the bot's role above "${BOT_ROLE_ANCHOR}" so it can assign roles.`);
    console.log('  3. Server Settings → Roles → @everyone → turn View Channel OFF.');
    console.log('  4. Give the bot Manage Roles and Manage Guild.');
  }

  client.destroy();
  process.exit(0);
});

client.login(botToken);
