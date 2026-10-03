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

  async function createPrivateChannel(guildId, { name, overwrites }) {
    const guild = await client.guilds.fetch(guildId);
    return guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });
  }

  // Which of the given permission names (e.g. 'SendMessages') the bot lacks
  // in a server channel.
  async function getMissingChannelPermissions(channelId, permissions) {
    const channel = await client.channels.fetch(channelId);
    const granted = channel?.permissionsFor?.(client.user);
    if (!granted) {
      throw new Error(`Discord channel ${channelId} was not found or isn't a server channel`);
    }
    return permissions.filter((permission) => !granted.has(permission));
  }

  return { client, ready, sendToChannel, sendDM, createPrivateChannel, getMissingChannelPermissions };
}
