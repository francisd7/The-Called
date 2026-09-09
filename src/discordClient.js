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

  const ready = new Promise((resolve, reject) => {
    client.once('clientReady', () => resolve());
    client.once('error', reject);
  });

  client.login(botToken);

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
