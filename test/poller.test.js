import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/poller.js';

test('poller sends new records in creation order and advances the watermark', async () => {
  const sent = [];
  const state = { demo: '2026-09-01T00:00:00.000Z' };
  const saved = [];

  const poller = createPoller({
    airtableClient: {
      listRecordsCreatedAfter: async () => [
        { id: 'rec2', createdTime: '2026-09-02T00:00:00.000Z', fields: {} },
        { id: 'rec1', createdTime: '2026-09-01T12:00:00.000Z', fields: {} },
      ],
    },
    discord: {
      sendToChannel: async (channelId, message) => sent.push({ channelId, message }),
    },
    state,
    saveState: async (s) => saved.push({ ...s }),
    log: { info: () => {}, error: () => {} },
  });

  await poller.pollAutomation({
    key: 'demo',
    baseId: 'appXXX',
    tableId: 'tblXXX',
    discordChannelId: 'chan1',
    formatMessage: (record) => `msg-${record.id}`,
  });

  assert.deepEqual(sent, [
    { channelId: 'chan1', message: 'msg-rec1' },
    { channelId: 'chan1', message: 'msg-rec2' },
  ]);
  assert.equal(state.demo, '2026-09-02T00:00:00.000Z');
  assert.equal(saved.length, 2);
});

test('poller seeds the watermark on first run without sending anything', async () => {
  const sent = [];
  const state = {};
  const saved = [];

  const poller = createPoller({
    airtableClient: {
      listRecordsCreatedAfter: async () => {
        throw new Error('should not be called before a watermark exists');
      },
    },
    discord: { sendToChannel: async () => sent.push(true) },
    state,
    saveState: async (s) => saved.push({ ...s }),
    log: { info: () => {}, error: () => {} },
  });

  await poller.pollAutomation({
    key: 'demo',
    baseId: 'a',
    tableId: 't',
    discordChannelId: 'c',
    formatMessage: () => '',
  });

  assert.equal(sent.length, 0);
  assert.ok(state.demo);
  assert.equal(saved.length, 1);
});

test('pollAll keeps going when one automation fails', async () => {
  const state = { ok: '2026-09-01T00:00:00.000Z', bad: '2026-09-01T00:00:00.000Z' };
  const sent = [];
  const errors = [];

  const poller = createPoller({
    airtableClient: {
      listRecordsCreatedAfter: async (baseId, tableId) => {
        if (tableId === 'bad-table') throw new Error('airtable is down');
        return [{ id: 'rec1', createdTime: '2026-09-02T00:00:00.000Z', fields: {} }];
      },
    },
    discord: { sendToChannel: async (channelId, message) => sent.push(message) },
    state,
    saveState: async () => {},
    log: { info: () => {}, error: (...args) => errors.push(args) },
  });

  await poller.pollAll([
    { key: 'bad', baseId: 'a', tableId: 'bad-table', discordChannelId: 'c', formatMessage: () => '' },
    { key: 'ok', baseId: 'a', tableId: 'ok-table', discordChannelId: 'c', formatMessage: () => 'hi' },
  ]);

  assert.deepEqual(sent, ['hi']);
  assert.equal(errors.length, 1);
});
