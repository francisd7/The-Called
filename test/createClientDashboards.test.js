import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientDashboards,
  resolveNotionTarget,
} from '../src/dashboards/createClientDashboards.js';

const SCHEMA = {
  Name: { type: 'title', title: {} },
  'Client Email': { type: 'email', email: {} },
};

const SILENT_LOG = { info() {}, warn() {}, error() {} };

function fakeNotion({ existingPage = null, templates } = {}) {
  const calls = { created: [] };
  return {
    calls,
    getDataSourceId: async () => ({ id: 'ds1', count: 1 }),
    getDataSourceProperties: async () => SCHEMA,
    listTemplates: async () =>
      templates ?? [{ id: 'tpl1', name: 'Client Dashboard', is_default: true }],
    findPageByEmail: async () => existingPage,
    createPageFromTemplate: async (args) => {
      calls.created.push(args);
      return { id: 'page1', url: 'https://notion.so/new-page' };
    },
  };
}

function fakeAirtable({ records, onUpdate } = {}) {
  const calls = { updates: [] };
  return {
    calls,
    listRecords: async () => records,
    updateRecord: async (baseId, tableId, recordId, fields) => {
      calls.updates.push({ recordId, fields });
      if (onUpdate) onUpdate();
      return {};
    },
  };
}

function fakeDiscord() {
  const calls = { messages: [] };
  return {
    calls,
    sendToChannel: async (channelId, message) => calls.messages.push({ channelId, message }),
  };
}

const ONE_CLIENT = [
  { id: 'rec1', fields: { 'Client Name': 'Sarah Smith', Email: 'sarah@example.com' } },
];

test('creates the page, writes the URL back to Airtable, and posts the handoff', async () => {
  const notionClient = fakeNotion();
  const airtableClient = fakeAirtable({ records: ONE_CLIENT });
  const discord = fakeDiscord();

  const result = await createClientDashboards({
    airtableClient,
    notionClient,
    discord,
    baseId: 'appX',
    databaseId: 'db1',
    notifyChannelId: 'chan1',
    log: SILENT_LOG,
  });

  assert.equal(notionClient.calls.created.length, 1);
  assert.equal(notionClient.calls.created[0].templateId, 'tpl1');
  assert.deepEqual(airtableClient.calls.updates, [
    { recordId: 'rec1', fields: { 'Notion Dashboard URL': 'https://notion.so/new-page' } },
  ]);
  assert.match(discord.calls.messages[0].message, /sarah@example\.com/);
  assert.deepEqual(result.failures, []);
  assert.equal(result.created[0].reused, false);
});

// The guard against the ugly failure mode: Notion page created, Airtable write
// failed, next cycle comes round again and makes a second dashboard.
test('reuses an existing page for that email instead of creating a duplicate', async () => {
  const notionClient = fakeNotion({
    existingPage: { id: 'page0', url: 'https://notion.so/already-there' },
  });
  const airtableClient = fakeAirtable({ records: ONE_CLIENT });
  const discord = fakeDiscord();

  const result = await createClientDashboards({
    airtableClient,
    notionClient,
    discord,
    baseId: 'appX',
    databaseId: 'db1',
    notifyChannelId: 'chan1',
    log: SILENT_LOG,
  });

  assert.equal(notionClient.calls.created.length, 0);
  assert.equal(airtableClient.calls.updates[0].fields['Notion Dashboard URL'], 'https://notion.so/already-there');
  assert.equal(result.created[0].reused, true);
});

test('stops the run on the first failure rather than working through the rest', async () => {
  const notionClient = fakeNotion();
  const airtableClient = fakeAirtable({
    records: [
      ...ONE_CLIENT,
      { id: 'rec2', fields: { 'Client Name': 'Second Client', Email: 'second@example.com' } },
    ],
    onUpdate: () => {
      throw new Error('Airtable update record failed (422): Unknown field name');
    },
  });
  const discord = fakeDiscord();

  const result = await createClientDashboards({
    airtableClient,
    notionClient,
    discord,
    baseId: 'appX',
    databaseId: 'db1',
    notifyChannelId: 'chan1',
    log: SILENT_LOG,
  });

  assert.equal(notionClient.calls.created.length, 1);
  assert.equal(result.created.length, 0);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /Unknown field name/);
  assert.match(discord.calls.messages.at(-1).message, /run stopped after an error/);
});

test('refuses to run when no template is set as default and none is named', async () => {
  const notionClient = fakeNotion({ templates: [{ id: 'tpl9', name: 'Something Else', is_default: false }] });

  await assert.rejects(
    () => resolveNotionTarget({ notionClient, databaseId: 'db1', templateName: '' }),
    /no default template set/
  );
});

test('names the templates it did find when the configured name does not match', async () => {
  const notionClient = fakeNotion({ templates: [{ id: 'tpl9', name: 'Something Else', is_default: true }] });

  await assert.rejects(
    () => resolveNotionTarget({ notionClient, databaseId: 'db1', templateName: 'Client Dashboard' }),
    /Templates found: Something Else/
  );
});

// Runs on the poll interval, so the common case is "nothing to do". It should
// cost zero Notion calls.
test('does not touch Notion at all when no client needs a dashboard', async () => {
  const notionClient = fakeNotion();
  let resolvedNotion = false;
  notionClient.getDataSourceId = async () => {
    resolvedNotion = true;
    return { id: 'ds1', count: 1 };
  };
  const airtableClient = fakeAirtable({ records: [] });
  const discord = fakeDiscord();

  const result = await createClientDashboards({
    airtableClient,
    notionClient,
    discord,
    baseId: 'appX',
    databaseId: 'db1',
    notifyChannelId: 'chan1',
    log: SILENT_LOG,
  });

  assert.equal(resolvedNotion, false);
  assert.deepEqual(result.created, []);
  assert.deepEqual(airtableClient.calls.updates, []);
  assert.deepEqual(discord.calls.messages, []);
});
