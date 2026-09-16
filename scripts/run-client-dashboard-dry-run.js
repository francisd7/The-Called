// One-time / on-demand admin utility — NOT part of the always-on server.
//
// DRY RUN ONLY. Reads the Notion database and the Airtable Clients table, then
// prints exactly what the real automation would do: which data source and
// template it resolved, which Notion columns it found, and the precise payload
// it would send for each client. Nothing is created in Notion and nothing is
// written to Airtable — there is no code path in this script that writes.
//
// This is the script to run against a mock Notion database before pointing
// anything at the real one.
//
// Usage:
//   NOTION_TOKEN=... NOTION_DASHBOARDS_DATABASE_ID=... AIRTABLE_PAT=... \
//     node scripts/run-client-dashboard-dry-run.js
import 'dotenv/config';
import { createAirtableClient } from '../src/airtableClient.js';
import { createNotionClient } from '../src/notionClient.js';
import { resolveNotionTarget } from '../src/dashboards/createClientDashboards.js';
import { CLIENTS_TABLE_ID } from '../src/reminders/weeklyCheckinReminder.js';
import {
  NEEDS_DASHBOARD_FORMULA,
  buildDashboardProperties,
  formatDryRunSummary,
  selectClientsNeedingDashboard,
} from '../src/dashboards/clientDashboard.js';

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DASHBOARDS_DATABASE_ID;
const airtablePat = process.env.AIRTABLE_PAT;
const templateName = process.env.NOTION_DASHBOARD_TEMPLATE_NAME || '';
const clientSuccessBaseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';

const missing = ['NOTION_TOKEN', 'NOTION_DASHBOARDS_DATABASE_ID', 'AIRTABLE_PAT'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const notionClient = createNotionClient(notionToken);
const airtableClient = createAirtableClient(airtablePat);

console.log('Resolving the Notion database...\n');
const target = await resolveNotionTarget({ notionClient, databaseId, templateName });

console.log(`Data source ID:  ${target.dataSourceId}`);
console.log(`Template in use: "${target.template.name}" (${target.template.id})`);
console.log(
  `All templates:   ${
    target.templates.map((t) => `${t.name}${t.is_default ? ' [default]' : ''}`).join(', ') || 'none'
  }`
);
console.log('\nNotion columns found:');
for (const [name, schema] of Object.entries(target.properties)) {
  console.log(`  • ${name} — ${schema.type}`);
}

console.log('\nFetching Airtable clients with no dashboard yet...\n');
const records = await airtableClient.listRecords(clientSuccessBaseId, CLIENTS_TABLE_ID, {
  filterByFormula: NEEDS_DASHBOARD_FORMULA,
});
const plan = selectClientsNeedingDashboard(records);

console.log(formatDryRunSummary(plan));

if (plan.toCreate.length > 0) {
  console.log('\nProperty payload per client:\n');
  for (const client of plan.toCreate) {
    const { properties, skipped } = buildDashboardProperties(target.properties, client.fields);
    console.log(`── ${client.clientName} ──`);
    console.log(JSON.stringify(properties, null, 2));
    if (skipped.length > 0) {
      console.log('  left blank:');
      for (const item of skipped) console.log(`    • ${item.notionColumn} — ${item.reason}`);
    }
    console.log('');
  }
}

console.log('Dry run complete. Nothing was created or written.');
