// One-time admin utility — NOT part of the always-on server, run manually.
//
// Grants the bot View Channel + Send Messages on every existing channel and
// category in every server it's a member of, so private/locked-down channels
// don't need to be fixed one by one.
//
// Requires the bot's role to temporarily have "Manage Channels" (Server
// Settings -> Roles -> the bot's role -> General Permissions) in each server
// this is run against — that permission is what lets it edit permissions on
// channels it can't otherwise see. Safe to remove that permission again once
// this has run successfully, since the per-channel grants it makes are
// independent, standing overwrites.
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

      const current = channel.permissionsFor(client.user);
      if (current?.has('ViewChannel') && current?.has('SendMessages')) {
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
      'A failure usually means the bot\'s role is missing "Manage Channels" in that ' +
        'server, or the bot is explicitly denied on that one channel.'
    );
  }

  client.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

client.login(token);
