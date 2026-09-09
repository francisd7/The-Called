import { Client, GatewayIntentBits } from 'discord.js';

export function createDiscordClient(botToken) {
  if (!botToken) {
    throw new Error('Discord bot token is required');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

  return { client, ready, sendToChannel };
}
