import { test } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import {
  buildChannelOverwrites,
  findClientByEmail,
  buildNewClientFields,
  registerNewMemberOnboarding,
} from '../src/onboarding/newMemberOnboarding.js';

test('buildChannelOverwrites denies @everyone and allows member/bot/CSM', () => {
  const overwrites = buildChannelOverwrites({
    guildId: 'guild1',
    memberId: 'member1',
    botUserId: 'bot1',
    csmRoleId: 'csm1',
  });

  assert.deepEqual(overwrites, [
    { id: 'guild1', deny: ['ViewChannel'] },
    { id: 'member1', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: 'bot1', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: 'csm1', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
  ]);
});

test('findClientByEmail normalizes and queries by a case/whitespace-insensitive formula', async () => {
  let capturedFormula;
  const airtableClient = {
    listRecords: async (baseId, tableId, { filterByFormula }) => {
      capturedFormula = filterByFormula;
      return [{ id: 'recABC' }];
    },
  };

  const result = await findClientByEmail(airtableClient, 'appXXX', '  Jane@Example.COM  ');

  assert.equal(result.id, 'recABC');
  assert.equal(capturedFormula, "LOWER(TRIM({Email})) = 'jane@example.com'");
});

test('findClientByEmail returns null when nothing matches', async () => {
  const airtableClient = { listRecords: async () => [] };
  const result = await findClientByEmail(airtableClient, 'appXXX', 'nobody@example.com');
  assert.equal(result, null);
});

test('buildNewClientFields builds a starter record with Status Active', () => {
  assert.deepEqual(
    buildNewClientFields({
      displayName: 'Jack Garcia',
      email: 'jack@example.com',
      discordUserId: 'member1',
      joinDate: '2026-09-09',
    }),
    {
      'Client Name': 'Jack Garcia',
      Email: 'jack@example.com',
      'Discord ID': 'member1',
      'Start Date': '2026-09-09',
      Status: 'Active',
    }
  );
});

function makeDiscordStub() {
  const client = new EventEmitter();
  client.user = { id: 'bot1' };
  const sentChannelMessages = [];
  return {
    client,
    createPrivateChannel: async () => {
      throw new Error('not used in these tests');
    },
    sendToChannel: async (channelId, message) => sentChannelMessages.push({ channelId, message }),
    sendDM: async () => {
      throw new Error('not used in these tests');
    },
    _sentChannelMessages: sentChannelMessages,
  };
}

function makeChannelStub(id) {
  const sent = [];
  return { id, send: async (message) => sent.push(message), _sent: sent };
}

test('messageCreate: matches a pending member\'s email, writes Discord ID, confirms', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const saved = [];
  const updates = [];
  const airtableClient = {
    listRecords: async () => [{ id: 'recABC' }],
    updateRecord: async (baseId, tableId, recordId, fields) => updates.push({ recordId, fields }),
    createRecord: async () => {
      throw new Error('should not create when a match was found');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    csmRoleId: 'csm1',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async (s) => saved.push(JSON.parse(JSON.stringify(s))),
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'jane@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { recordId: 'recABC', fields: { 'Discord ID': 'member1' } });
  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /You're all set/);
  assert.equal(state.newMemberOnboardingPending.chan1, undefined);
});

test('messageCreate: no match creates a starter Client record and flags staff to fill it in', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const created = [];
  const airtableClient = {
    listRecords: async () => [],
    updateRecord: async () => {
      throw new Error('should not update when nothing matched');
    },
    createRecord: async (baseId, tableId, fields) => {
      created.push({ baseId, tableId, fields });
      return { id: 'recNEW' };
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    csmRoleId: 'csm1',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'nobody@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(created.length, 1);
  assert.equal(created[0].fields['Client Name'], 'Jane Doe');
  assert.equal(created[0].fields.Email, 'nobody@example.com');
  assert.equal(created[0].fields['Discord ID'], 'member1');
  assert.equal(created[0].fields.Status, 'Active');
  assert.match(created[0].fields['Start Date'], /^\d{4}-\d{2}-\d{2}$/);

  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /You're all set/);

  assert.equal(discord._sentChannelMessages.length, 1);
  assert.equal(discord._sentChannelMessages[0].channelId, 'flagChan');
  assert.match(discord._sentChannelMessages[0].message, /nobody@example\.com/);
  assert.match(discord._sentChannelMessages[0].message, /starter record/);

  assert.equal(state.newMemberOnboardingPending.chan1, undefined);
});

test('messageCreate: non-email text prompts a retry without querying Airtable', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const airtableClient = {
    listRecords: async () => {
      throw new Error('should not query for non-email text');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    csmRoleId: 'csm1',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'hey whats up',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /doesn't look like an email/);
  // still pending - not cleared
  assert.deepEqual(state.newMemberOnboardingPending.chan1, {
    discordUserId: 'member1',
    displayName: 'Jane Doe',
  });
});

test('messageCreate: ignores messages from someone other than the pending member', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const airtableClient = {
    listRecords: async () => {
      throw new Error('should not be called for a different author');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    csmRoleId: 'csm1',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'someone-else', bot: false },
    channel,
    content: 'jane@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(channel._sent.length, 0);
});
