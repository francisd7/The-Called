// One-time / on-demand admin utility — NOT part of the always-on server.
//
// Creates ONE real Notion dashboard for one client, so you can see the finished
// article end-to-end before enabling the automation for everyone.
//
// By default it does NOT write the resulting URL back to Airtable. That's
// deliberate: while you're testing against a mock Notion database, writing a
// mock URL onto the real Client record would make the live automation later
// think that client is already done and skip them. Pass --write-airtable only
// once you're pointed at the real database.
//
// Usage:
//   node scripts/create-one-client-dashboard.js client@example.com
//   node scripts/create-one-client-dashboard.js client@example.com --write-airtable
import 'dotenv/config';
import { createAirtableClient } from '../src/airtableClient.js';
import { createNotionClient } from '../src/notionClient.js';
import { resolveNotionTarget } from '../src/dashboards/createClientDashboards.js';
import { findClientByEmail } from '../src/onboarding/newMemberOnboarding.js';
import { CLIENTS_TABLE_ID } from '../src/reminders/weeklyCheckinReminder.js';
import { DASHBOARD_URL_FIELD, buildDashboardProperties } from '../src/dashboards/clientDashboard.js';

const email = process.argv[2];
const writeToAirtable = process.argv.includes('--write-airtable');

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DASHBOARDS_DATABASE_ID;
const airtablePat = process.env.AIRTABLE_PAT;
const templateName = process.env.NOTION_DASHBOARD_TEMPLATE_NAME || '';
const clientSuccessBaseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/create-one-client-dashboard.js <client email> [--write-airtable]');
  process.exit(1);
}

const missing = ['NOTION_TOKEN', 'NOTION_DASHBOARDS_DATABASE_ID', 'AIRTABLE_PAT'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(`Set these first (in your .env file): ${missing.join(', ')}`);
  process.exit(1);
}

const notionClient = createNotionClient(notionToken);
const airtableClient = createAirtableClient(airtablePat);

const record = await findClientByEmail(airtableClient, clientSuccessBaseId, email);
if (!record) {
  console.error(`No Airtable Client record found with Email = ${email}`);
  process.exit(1);
}

const target = await resolveNotionTarget({ notionClient, databaseId, templateName });
const { properties, skipped } = buildDashboardProperties(target.properties, record.fields);

console.log(`Creating a dashboard for ${record.fields['Client Name']} from template "${target.template.name}"...`);
const page = await notionClient.createPageFromTemplate({
  dataSourceId: target.dataSourceId,
  templateId: target.template.id,
  properties,
});

console.log(`\n✅ Created: ${page.url}`);
if (skipped.length > 0) {
  console.log('\nColumns left blank:');
  for (const item of skipped) console.log(`  • ${item.notionColumn} — ${item.reason}`);
}

if (writeToAirtable) {
  await airtableClient.updateRecord(clientSuccessBaseId, CLIENTS_TABLE_ID, record.id, {
    [DASHBOARD_URL_FIELD]: page.url,
  });
  console.log(`\nWrote the URL to Airtable (${DASHBOARD_URL_FIELD}).`);
} else {
  console.log(
    `\nDid NOT write to Airtable. Re-run with --write-airtable once you're on the real database.`
  );
}

console.log(`\nLast step: open it → Share → invite ${email} → Can edit.`);
