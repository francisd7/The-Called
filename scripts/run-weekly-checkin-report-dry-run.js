// On-demand admin utility — NOT part of the always-on server.
//
// DRY RUN ONLY. Builds the Saturday "who hasn't checked in" report from live
// Airtable data and prints it to the terminal. There is no code path in this
// script that posts to Discord — safe to run whenever, including to preview
// what Saturday's message will say before turning the job on.
//
// Usage:
//   node scripts/run-weekly-checkin-report-dry-run.js
//   node scripts/run-weekly-checkin-report-dry-run.js --days 14
import 'dotenv/config';
import { createAirtableClient } from '../src/airtableClient.js';
import { CLIENTS_TABLE_ID, ACTIVE_CLIENTS_FORMULA } from '../src/reminders/weeklyCheckinReminder.js';
import { tableId as CHECKIN_TABLE_ID } from '../src/automations/weeklyCheckin.js';
import { buildMissingReport, formatMissingReport } from '../src/reminders/weeklyCheckinReport.js';
import { getLocalDateString } from '../src/reminders/schedule.js';
import { DEFAULT_LOOKBACK_DAYS } from '../src/reminders/sendWeeklyCheckinReport.js';

const daysFlag = process.argv.indexOf('--days');
const lookbackDays =
  daysFlag === -1 ? DEFAULT_LOOKBACK_DAYS : Number(process.argv[daysFlag + 1]) || DEFAULT_LOOKBACK_DAYS;

if (!process.env.AIRTABLE_PAT) {
  console.error('Set AIRTABLE_PAT first (in your .env file).');
  process.exit(1);
}

const baseId = process.env.AIRTABLE_CLIENT_SUCCESS_BASE_ID || 'appkSTSqkeXGHt6pY';
const airtableClient = createAirtableClient(process.env.AIRTABLE_PAT);
const timeZone = 'America/New_York';

const now = new Date();
const cutoffIso = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

const [clientRecords, checkinRecords] = await Promise.all([
  airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, { filterByFormula: ACTIVE_CLIENTS_FORMULA }),
  airtableClient.listRecords(baseId, CHECKIN_TABLE_ID),
]);

console.log(
  `DRY RUN — nothing will be posted.\n` +
    `${clientRecords.length} active clients, ${checkinRecords.length} check-ins on file.\n` +
    `Counting check-ins created since ${cutoffIso} (${lookbackDays} days).\n`
);

const report = buildMissingReport({ clientRecords, checkinRecords, cutoffIso });

console.log('--- message as it would be posted ---\n');
console.log(formatMissingReport(report, { weekLabel: getLocalDateString(now, timeZone) }));
console.log('\n--- end ---');
