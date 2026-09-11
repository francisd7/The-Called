import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

// extraIntents lets callers opt into privileged intents (GuildMembers,
// MessageContent) only when the feature that needs them is actually enabled.
// Requesting a privileged intent that isn't turned on in the Discord
// Developer Portal makes login fail outright, so this must stay opt-in - the
// base Setter EOD / Weekly Check-in / reminder automations never need it and
// must keep working even before anyone enables those portal toggles.
export function createDiscordClient(botToken, { extraIntents = [] } = {}) {
  if (!botToken) {
    throw new Error('Discord bot token is required');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...extraIntents] });

  // Resolves when the gateway connects, and never rejects. Login is retried
  // instead of failing once: a TLS handshake failure against Discord
  // (ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE, seen on 2026-09-11) used to leave
  // this promise pending forever, and everything awaiting it stopped there.
  const ready = new Promise((resolve) => {
    client.once('clientReady', () => resolve());
  });

  // A standing listener, separate from the one-shot above. `once` removes
  // itself after firing, and discord.js Client is an EventEmitter - an
  // 'error' event with no listener THROWS, so the second gateway error after
  // boot would take the whole service down. On a bot that stays up for days,
  // reconnects and socket blips are routine, not exceptional.
  //
  // Logging and carrying on is right here: discord.js reconnects on its own,
  // and a dropped websocket is not a reason to stop polling Airtable.
  client.on('error', (err) => {
    console.error('[discord] client error (recovering):', err?.message ?? err);
  });
  client.on('shardError', (err) => {
    console.error('[discord] shard error (recovering):', err?.message ?? err);
  });

  // Exponential backoff, capped, forever. A transient network or TLS problem
  // between Railway and Discord is not a reason to give up for good - the
  // process staying alive and retrying is what lets a weekly job catch up
  // once the connection comes back.
  async function loginWithRetry(attempt = 1) {
    try {
      await client.login(botToken);
    } catch (err) {
      const delay = Math.min(30_000, 2 ** attempt * 1000);
      console.error(
        `[discord] login attempt ${attempt} failed, retrying in ${delay / 1000}s:`,
        err?.message ?? err
      );
      setTimeout(() => loginWithRetry(attempt + 1), delay);
    }
  }
  loginWithRetry();

  async function sendToChannel(channelId, message) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${channelId} was not found or isn't a text channel`);
    }
    await channel.send(message);
  }

  async function sendDM(userId, message) {
    const user = await client.users.fetch(userId);
    await user.send(message);
  }

  // `parent` files the channel under a tier category. The overwrites are
  // still passed in full rather than synced from that category - a client
  // channel always carries one overwrite the category can't (the client's
  // own access), so it is unsynced by definition and inherits nothing.
  async function createPrivateChannel(guildId, { name, overwrites, parent }) {
    const guild = await client.guilds.fetch(guildId);
    return guild.channels.create({
      name,
      type: ChannelType.GuildText,
      ...(parent ? { parent } : {}),
      permissionOverwrites: overwrites,
    });
  }

  async function fetchGuildInvites(guildId) {
    const guild = await client.guilds.fetch(guildId);
    const invites = await guild.invites.fetch();
    return [...invites.values()].map((invite) => ({ code: invite.code, uses: invite.uses ?? 0 }));
  }

  return { client, ready, sendToChannel, sendDM, createPrivateChannel, fetchGuildInvites };
}
