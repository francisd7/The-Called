// One-time admin utility — NOT part of the always-on server, run manually.
//
// Grants the bot View Channel + Send Messages on every existing channel and
// category in every server it's a member of, so private/locked-down channels
// don't need to be fixed one by one.
//
// Requires the bot's role to temporarily have "Administrator" (Server Settings
// -> Roles -> the bot's role -> General Permissions) in each server this is run
// against. Plain "Manage Roles" is not enough on a server that also denies
// Manage Roles at the category/channel level for non-staff roles (a common
// lockdown pattern) — Administrator is the only permission that bypasses
// per-channel overwrite checks entirely. Safe to remove again once this has
// run successfully: it checks for and creates an *explicit* per-channel
// overwrite for the bot (not just "does it currently have access"), so the
// access this grants doesn't depend on Administrator staying on.
//
// Usage: DISCORD_BOT_TOKEN=... node scripts/grant-bot-channel-access.js
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in your environment (or a local .env file) first.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}.\n`);

  let granted = 0;
  let alreadyOk = 0;
  let failed = 0;

  for (const guild of client.guilds.cache.values()) {
    console.log(`Server: ${guild.name}`);
    const channels = await guild.channels.fetch();

    for (const channel of channels.values()) {
      if (!channel?.permissionOverwrites) continue;

      // Check for an explicit overwrite on this channel, not computed effective
      // permissions — the latter would report "already has access" everywhere
      // while Administrator is temporarily on, masking channels that still need
      // a real overwrite once Administrator comes back off.
      const existingOverwrite = channel.permissionOverwrites.cache.get(client.user.id);
      if (existingOverwrite?.allow.has('ViewChannel') && existingOverwrite?.allow.has('SendMessages')) {
        alreadyOk += 1;
        continue;
      }

      try {
        await channel.permissionOverwrites.edit(client.user.id, {
          ViewChannel: true,
          SendMessages: true,
        });
        granted += 1;
        console.log(`  granted:  #${channel.name}`);
      } catch (err) {
        failed += 1;
        console.log(`  FAILED:   #${channel.name} — ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Granted: ${granted}, already had access: ${alreadyOk}, failed: ${failed}.`);
  if (failed > 0) {
    console.log(
      'A failure usually means the bot\'s role is missing "Administrator" in that server.'
    );
  }

  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(token);
