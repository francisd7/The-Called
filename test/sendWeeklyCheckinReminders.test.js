import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { sendWeeklyCheckinReminders } from '../src/reminders/sendWeeklyCheckinReminders.js';

function makeRecord(id, fields) {
  return { id, fields };
}

// The guild shape the real code walks: a MOMENTUM category plus private
// channels whose only link to a client is a permission overwrite. Overwrites
// are given as a manager with a `.cache` Collection, matching discord.js -
// passing plain arrays here is what hid a bug where the lookup threw on every
// real channel.
function fakeGuild(channels) {
  return {
    channels: {
      fetch: async () => {},
      cache: new Map(channels.map((channel) => [channel.id, channel])),
    },
  };
}

function categoryChannel(id, name) {
  return { id, name, type: ChannelType.GuildCategory, parentId: null };
}

function clientChannel(id, name, parentId, memberIds) {
  return {
    id,
    name,
    parentId,
    type: ChannelType.GuildText,
    permissionOverwrites: { cache: new Map(memberIds.map((memberId) => [memberId, {}])) },
  };
}

function discordDouble(guild, posted, { failOn } = {}) {
  return {
    client: { guilds: { fetch: async () => guild } },
    sendToChannel: async (channelId, message) => {
      if (channelId === failOn) throw new Error('Missing Permissions');
      posted.push({ channelId, message });
    },
  };
}

test('posts into each client\'s own channel, skips the rest, and summarises', async () => {
  const records = [
    makeRecord('rec1', {
      'Client Name': 'Jane Doe',
      'Discord ID': '111',
      'Weekly Check-in Link': 'https://airtable.com/1',
    }),
    makeRecord('rec2', { 'Client Name': 'No ID Client' }),
    makeRecord('rec3', {
      'Client Name': 'Opted Out',
      'Discord ID': '222',
      'Skip Weekly Reminder': true,
    }),
  ];

  const guild = fakeGuild([
    categoryChannel('cat-momentum', 'MOMENTUM'),
    clientChannel('chan-jane', 'jane-doe', 'cat-momentum', ['111']),
  ]);
  const posted = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: { listRecords: async () => records },
    discord: discordDouble(guild, posted),
    baseId: 'appXXX',
    clientGuildId: 'guild1',
    logChannelId: 'chan1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  const reminder = posted.find((entry) => entry.channelId === 'chan-jane');
  assert.ok(reminder, 'posted into the client\'s own channel');
  // Mentioned, not named: a mention actually notifies them, which is the one
  // thing a DM did better.
  assert.match(reminder.message, /^Hey <@111>, time for your Weekly Check-in/);

  assert.equal(result.sentCount, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.noChannel.length, 0);
  assert.equal(result.skipped.length, 2);

  const summary = posted.find((entry) => entry.channelId === 'chan1');
  assert.match(summary.message, /1\/1 in their own channels/);
  assert.match(summary.message, /1 no Discord ID on file, 1 opted out/);
});

test('the category name is matched past decorative emoji', async () => {
  const guild = fakeGuild([
    categoryChannel('cat-momentum', '\u{1F4C8}│MOMENTUM'),
    clientChannel('chan-jane', 'jane-doe', 'cat-momentum', ['111']),
  ]);
  const posted = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: {
      listRecords: async () => [makeRecord('rec1', { 'Client Name': 'Jane', 'Discord ID': '111' })],
    },
    discord: discordDouble(guild, posted),
    baseId: 'appXXX',
    clientGuildId: 'guild1',
    logChannelId: 'chan1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  assert.equal(result.sentCount, 1);
});

test('a client with no private channel is reported, never quietly DMed instead', async () => {
  // Falling back to a DM would hide the thing worth fixing: they are on a tier
  // that should have a channel, or theirs is outside the tier categories.
  const guild = fakeGuild([categoryChannel('cat-momentum', 'MOMENTUM')]);
  const posted = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: {
      listRecords: async () => [
        makeRecord('rec1', { 'Client Name': 'Homeless Hank', 'Discord ID': '111' }),
      ],
    },
    discord: discordDouble(guild, posted),
    baseId: 'appXXX',
    clientGuildId: 'guild1',
    logChannelId: 'chan1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.sentCount, 0);
  assert.deepEqual(result.noChannel.map((entry) => entry.clientName), ['Homeless Hank']);
  const summary = posted.find((entry) => entry.channelId === 'chan1');
  assert.match(summary.message, /No private channel found \(1\):\n• Homeless Hank/);
});

test('a channel that rejects the post is reported without stopping the run', async () => {
  const guild = fakeGuild([
    categoryChannel('cat-momentum', 'MOMENTUM'),
    clientChannel('chan-fail', 'will-fail', 'cat-momentum', ['111']),
    clientChannel('chan-ok', 'will-succeed', 'cat-momentum', ['222']),
  ]);
  const posted = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: {
      listRecords: async () => [
        makeRecord('rec1', { 'Client Name': 'Will Fail', 'Discord ID': '111' }),
        makeRecord('rec2', { 'Client Name': 'Will Succeed', 'Discord ID': '222' }),
      ],
    },
    discord: discordDouble(guild, posted, { failOn: 'chan-fail' }),
    baseId: 'appXXX',
    clientGuildId: 'guild1',
    logChannelId: 'chan1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.sentCount, 1);
  assert.deepEqual(result.failures.map((entry) => entry.clientName), ['Will Fail']);
  const summary = posted.find((entry) => entry.channelId === 'chan1');
  assert.match(summary.message, /Failed to post \(1\)/);
});

test('a channel outside the tier categories is not mistaken for a private one', async () => {
  // A client holds an overwrite on plenty of shared channels; only the ones
  // parented to a tier category are theirs.
  const guild = fakeGuild([
    categoryChannel('cat-momentum', 'MOMENTUM'),
    categoryChannel('cat-forge', 'THE FORGE'),
    clientChannel('chan-wins', 'wins', 'cat-forge', ['111']),
  ]);
  const posted = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: {
      listRecords: async () => [makeRecord('rec1', { 'Client Name': 'Jane', 'Discord ID': '111' })],
    },
    discord: discordDouble(guild, posted),
    baseId: 'appXXX',
    clientGuildId: 'guild1',
    logChannelId: 'chan1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.sentCount, 0);
  assert.equal(result.noChannel.length, 1);
});
