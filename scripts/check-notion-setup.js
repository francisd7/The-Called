// One-time / on-demand admin utility — NOT part of the always-on server.
//
// READ ONLY. Answers one question: "is the Notion side ready?" It needs no
// Airtable access and touches nothing, so it's the first thing to run the
// moment a token arrives — it separates a Notion problem from an Airtable one
// before the fuller dry run muddles the two together.
//
// Checks, in order: the token works, the database ID resolves, a template is
// set as default, every column the automation maps to exists, and the types
// are ones the API can actually write.
//
// Usage:
//   NOTION_TOKEN=... NOTION_DASHBOARDS_DATABASE_ID=... node scripts/check-notion-setup.js
import 'dotenv/config';
import { createNotionClient } from '../src/notionClient.js';
import { resolveNotionTarget } from '../src/dashboards/createClientDashboards.js';
import { DEFAULT_FIELD_MAP } from '../src/dashboards/clientDashboard.js';

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DASHBOARDS_DATABASE_ID;
const templateName = process.env.NOTION_DASHBOARD_TEMPLATE_NAME || '';

const missingEnv = ['NOTION_TOKEN', 'NOTION_DASHBOARDS_DATABASE_ID'].filter(
  (name) => !process.env[name]
);
if (missingEnv.length > 0) {
  console.error(`Set these first (in your .env file): ${missingEnv.join(', ')}`);
  process.exit(1);
}

const problems = [];
const warnings = [];

let target;
try {
  target = await resolveNotionTarget({
    notionClient: createNotionClient(notionToken),
    databaseId,
    templateName,
  });
} catch (err) {
  console.error(`\n❌ ${err.message}\n`);
  if (/401|unauthorized/i.test(err.message)) {
    console.error('That reads like a bad or expired token.');
  } else if (/404|not.?found/i.test(err.message)) {
    console.error(
      'A 404 here almost always means the integration is not connected to the\n' +
        'database rather than a wrong ID: open the database → ••• → Connections\n' +
        '→ add it. The API cannot see anything it has not been connected to.'
    );
  }
  process.exit(1);
}

console.log('\n✅ Token works, database resolved.');
console.log(`   Data source: ${target.dataSourceId}`);
console.log(`   Template:    "${target.template.name}"`);
if (target.dataSourceCount > 1) {
  warnings.push(`Database has ${target.dataSourceCount} data sources; the first one will be used.`);
}

console.log('\nColumn check:');
for (const [airtableField, notionColumn] of Object.entries(DEFAULT_FIELD_MAP)) {
  const schema = target.properties[notionColumn];

  if (!schema) {
    problems.push(`No column named "${notionColumn}" — Airtable's "${airtableField}" has nowhere to go.`);
    console.log(`   ❌ ${notionColumn.padEnd(14)} missing`);
    continue;
  }

  // Status is the one type whose options the API can't create, so a value
  // Airtable supplies that isn't already an option gets silently dropped.
  if (schema.type === 'status') {
    warnings.push(
      `"${notionColumn}" is a Status property. The API can't create Status options, so any value not already listed is dropped. Change it to a Select unless every value already exists.`
    );
    console.log(`   ⚠️  ${notionColumn.padEnd(14)} status (see warnings)`);
    continue;
  }

  console.log(`   ✅ ${notionColumn.padEnd(14)} ${schema.type}`);
}

if (!Object.values(target.properties).some((schema) => schema.type === 'email')) {
  problems.push(
    'No Email-type column. That column is how a duplicate dashboard is detected, so without it a failed run can create a second page for the same client.'
  );
}

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings) console.log(`   ⚠️  ${warning}`);
}

if (problems.length > 0) {
  console.log('\nProblems to fix:');
  for (const problem of problems) console.log(`   ❌ ${problem}`);
  console.log('\nNot ready yet.\n');
  process.exit(1);
}

console.log('\n✅ Notion side is ready. Next: npm run client-dashboard-dry-run\n');
