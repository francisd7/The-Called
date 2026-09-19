import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_URL_FIELD,
  buildDashboardProperties,
  formatDashboardCreatedMessage,
  selectClientsNeedingDashboard,
} from '../src/dashboards/clientDashboard.js';

// Mirrors the columns in the Client Dashboards database: Name (title),
// Client Email (email), CSM (select), Start Date (date), Package (select),
// Status (select).
const NOTION_SCHEMA = {
  Name: { type: 'title', title: {} },
  'Client Email': { type: 'email', email: {} },
  CSM: { type: 'select', select: { options: [{ name: 'Noah' }] } },
  'Start Date': { type: 'date', date: {} },
  Package: { type: 'select', select: { options: [] } },
  Status: { type: 'select', select: { options: [{ name: 'Active' }] } },
};

const FULL_CLIENT = {
  'Client Name': 'Sarah Smith',
  Email: 'sarah@example.com',
  CSM: 'Noah',
  'Package / Tier': 'Accelerator',
  'Start Date': '2026-09-01',
  Status: 'Active',
};

test('maps every Airtable field onto the right Notion property type', () => {
  const { properties } = buildDashboardProperties(NOTION_SCHEMA, FULL_CLIENT);

  assert.deepEqual(properties.Name, { title: [{ text: { content: 'Sarah Smith' } }] });
  assert.deepEqual(properties['Client Email'], { email: 'sarah@example.com' });
  assert.deepEqual(properties.CSM, { select: { name: 'Noah' } });
  assert.deepEqual(properties['Start Date'], { date: { start: '2026-09-01' } });
  assert.deepEqual(properties.Status, { select: { name: 'Active' } });
});

test('maps "Package / Tier" onto the "Package" column despite the rename', () => {
  const { properties } = buildDashboardProperties(NOTION_SCHEMA, FULL_CLIENT);
  assert.deepEqual(properties.Package, { select: { name: 'Accelerator' } });
});

test('a select option that does not exist yet is still sent — Notion creates it', () => {
  const { properties } = buildDashboardProperties(NOTION_SCHEMA, {
    ...FULL_CLIENT,
    CSM: 'Someone New',
  });
  assert.deepEqual(properties.CSM, { select: { name: 'Someone New' } });
});

test('skips empty Airtable fields rather than sending blank values', () => {
  const { properties, skipped } = buildDashboardProperties(NOTION_SCHEMA, {
    ...FULL_CLIENT,
    CSM: '',
    'Start Date': null,
  });

  assert.equal('CSM' in properties, false);
  assert.equal('Start Date' in properties, false);
  assert.equal(skipped.some((item) => item.notionColumn === 'CSM'), true);
});

// The whole point of reading the schema first: pointing this at a different
// database (a mock one, or the real one after a rename) must not 400.
test('skips mapped columns the Notion database does not have', () => {
  const minimalSchema = { Name: { type: 'title', title: {} } };
  const { properties, skipped } = buildDashboardProperties(minimalSchema, FULL_CLIENT);

  assert.deepEqual(Object.keys(properties), ['Name']);
  assert.equal(
    skipped.some(
      (item) =>
        item.notionColumn === 'Client Email' &&
        item.reason.includes('no column with that name')
    ),
    true
  );
});

// Status is the one property type whose options can't be created through the
// API, so an unknown value has to be dropped instead of failing the page.
test('drops a Status value that is not an existing option of a status property', () => {
  const statusSchema = {
    ...NOTION_SCHEMA,
    Status: { type: 'status', status: { options: [{ name: 'In progress' }] } },
  };
  const { properties, skipped } = buildDashboardProperties(statusSchema, FULL_CLIENT);

  assert.equal('Status' in properties, false);
  assert.match(
    skipped.find((item) => item.notionColumn === 'Status').reason,
    /not one of its options/
  );
});

test('keeps a Status value that does exist as an option', () => {
  const statusSchema = {
    ...NOTION_SCHEMA,
    Status: { type: 'status', status: { options: [{ name: 'Active' }] } },
  };
  const { properties } = buildDashboardProperties(statusSchema, FULL_CLIENT);
  assert.deepEqual(properties.Status, { status: { name: 'Active' } });
});

test('selects only clients with a name, an email, and no dashboard yet', () => {
  const { toCreate, skipped } = selectClientsNeedingDashboard([
    { id: 'rec1', fields: { 'Client Name': 'Sarah Smith', Email: 'sarah@example.com' } },
    {
      id: 'rec2',
      fields: {
        'Client Name': 'Already Done',
        Email: 'done@example.com',
        [DASHBOARD_URL_FIELD]: 'https://notion.so/abc',
      },
    },
    { id: 'rec3', fields: { 'Client Name': 'No Email' } },
    { id: 'rec4', fields: { Email: 'noname@example.com' } },
  ]);

  assert.deepEqual(
    toCreate.map((item) => item.clientName),
    ['Sarah Smith']
  );
  assert.deepEqual(
    skipped.map((item) => item.reason),
    ['already has a dashboard', 'no Email on the record', 'no Client Name on the record']
  );
});

test('the Discord handoff message carries the link and the email to invite', () => {
  const message = formatDashboardCreatedMessage({
    clientName: 'Sarah Smith',
    email: 'sarah@example.com',
    url: 'https://notion.so/sarah',
  });

  assert.match(message, /Sarah Smith/);
  assert.match(message, /https:\/\/notion\.so\/sarah/);
  assert.match(message, /sarah@example\.com/);
  assert.match(message, /Can edit/);
});

test('the handoff message lists columns that were left blank', () => {
  const message = formatDashboardCreatedMessage({
    clientName: 'Sarah Smith',
    email: 'sarah@example.com',
    url: 'https://notion.so/sarah',
    skipped: [{ notionColumn: 'CSM', reason: 'no column with that name in the Notion database' }],
  });

  assert.match(message, /Columns left blank:/);
  assert.match(message, /CSM — no column with that name/);
});

// The workspace's existing habit is to grant Full access to everyone, and a
// client with Full access could re-share the dashboard to anyone at all -
// straight through the "clients must not be able to duplicate this" rule.
test('the handoff message warns against granting Full access', () => {
  const message = formatDashboardCreatedMessage({
    clientName: 'Sarah Smith',
    email: 'sarah@example.com',
    url: 'https://notion.so/sarah',
  });

  assert.match(message, /never \*\*Full access\*\*/);
  assert.match(message, /re-share this dashboard/);
});
