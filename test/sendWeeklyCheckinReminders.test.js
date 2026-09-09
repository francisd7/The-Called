import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendWeeklyCheckinReminders } from '../src/reminders/sendWeeklyCheckinReminders.js';

function makeRecord(id, fields) {
  return { id, fields };
}

test('sends to everyone with a Discord ID, skips the rest, and posts a summary', async () => {
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

  const dmsSent = [];
  const channelMessages = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: { listRecords: async () => records },
    discord: {
      sendDM: async (userId, message) => dmsSent.push({ userId, message }),
      sendToChannel: async (channelId, message) => channelMessages.push({ channelId, message }),
    },
    baseId: 'appXXX',
    logChannelId: 'chan1',
    log: { info: () => {}, error: () => {} },
  });

  assert.equal(dmsSent.length, 1);
  assert.equal(dmsSent[0].userId, '111');
  assert.match(dmsSent[0].message, /^Hey Jane, time for your Weekly Check-in/);

  assert.equal(result.sentCount, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.skipped.length, 2);

  assert.equal(channelMessages.length, 1);
  assert.equal(channelMessages[0].channelId, 'chan1');
  assert.match(channelMessages[0].message, /1\/1 delivered/);
  assert.match(channelMessages[0].message, /1 no Discord ID on file, 1 opted out/);
});

test('a failed DM is logged and reported in the summary, without stopping the run', async () => {
  const records = [
    makeRecord('rec1', { 'Client Name': 'Will Fail', 'Discord ID': '111' }),
    makeRecord('rec2', { 'Client Name': 'Will Succeed', 'Discord ID': '222' }),
  ];

  const dmsSent = [];
  const channelMessages = [];

  const result = await sendWeeklyCheckinReminders({
    airtableClient: { listRecords: async () => records },
    discord: {
      sendDM: async (userId, message) => {
        if (userId === '111') throw new Error('Cannot send messages to this user');
        dmsSent.push({ userId, message });
      },
      sendToChannel: async (channelId, message) => channelMessages.push({ channelId, message }),
    },
    baseId: 'appXXX',
    logChannelId: 'chan1',
    log: { info: () => {}, error: () => {} },
  });

  assert.equal(dmsSent.length, 1);
  assert.equal(result.sentCount, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].clientName, 'Will Fail');

  assert.match(channelMessages[0].message, /1\/2 delivered/);
  assert.match(channelMessages[0].message, /Failed to deliver \(1\)/);
  assert.match(channelMessages[0].message, /Will Fail — Cannot send messages to this user/);
});
