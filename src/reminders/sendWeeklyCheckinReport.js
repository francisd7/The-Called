import { CLIENTS_TABLE_ID, ACTIVE_CLIENTS_FORMULA } from './weeklyCheckinReminder.js';
import { tableId as CHECKIN_TABLE_ID } from '../automations/weeklyCheckin.js';
import { buildMissingReport, formatMissingReport } from './weeklyCheckinReport.js';
import { getLocalDateString, BUSINESS_TIMEZONE } from './schedule.js';

// A whole week, not the hours since Friday's DM. The two check-ins on file
// when this was built both arrived on Thursday evening, before that week's
// reminder went out - a "since the reminder" window would have listed both
// clients as missing when they had already done it. The question the team
// wants answered is "did they check in this week", and people do not wait to
// be asked.
export const DEFAULT_LOOKBACK_DAYS = 7;

// Zero by design: a brand-new client is expected to check in like everyone
// else. Their first one is a baseline their CSM wants before the onboarding
// call, not a chore they haven't earned yet - which is the opposite of the
// obvious assumption, and the reason this is a knob rather than a hard rule.
//
// It still does work at zero. Someone whose Start Date is in the future has
// not begun, and chasing them for a week that hasn't started is noise. Raise
// WEEKLY_REPORT_GRACE_DAYS if the reports ever get noisy with new joiners.
export const DEFAULT_GRACE_DAYS = 0;

export async function sendWeeklyCheckinReport({
  airtableClient,
  discord,
  baseId,
  channelId,
  now = new Date(),
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  graceDays = DEFAULT_GRACE_DAYS,
  timeZone = BUSINESS_TIMEZONE,
  log = console,
}) {
  const cutoffIso = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const startedAfterDate = getLocalDateString(
    new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000),
    timeZone
  );

  const [clientRecords, checkinRecords] = await Promise.all([
    airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
      filterByFormula: ACTIVE_CLIENTS_FORMULA,
    }),
    // Fetched unfiltered and narrowed in memory. The table holds one row per
    // client per week, so it stays small for years, and a formula on
    // CREATED_TIME() is the kind of thing that silently returns nothing when
    // Airtable changes how it parses dates.
    airtableClient.listRecords(baseId, CHECKIN_TABLE_ID),
  ]);

  const report = buildMissingReport({ clientRecords, checkinRecords, cutoffIso, startedAfterDate });
  const message = formatMissingReport(report, {
    weekLabel: getLocalDateString(now, timeZone),
  });

  await discord.sendToChannel(channelId, message);
  log.info(
    `[weeklyCheckinReport] ${report.missing.length} missing of ${report.expectedCount} expected.`
  );

  return report;
}
