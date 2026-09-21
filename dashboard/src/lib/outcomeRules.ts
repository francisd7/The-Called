/**
 * When a call still needs somebody to say what happened.
 *
 * Its own module because the rule was wrong in a way that was invisible from
 * the query that used it. The dashboard asked only whether `outcomeLoggedAt`
 * was set - a column stamped when somebody presses Log outcome and by nothing
 * else - so every outcome that arrived through the Airtable import or the
 * post-call form counted as missing. Twenty-eight calls sat on the front page
 * under "been and gone without a result recorded" while 27 had showed, 14 had
 * closed, and the oldest was ten weeks old. A list that is wrong every time
 * gets scrolled past, and takes the real entries with it.
 *
 * Here it can be named, explained and tested against a real table.
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { leads } from '../db/schema.ts';

/**
 * Anything that says how a call went, whoever recorded it.
 *
 * `IS NOT TRUE` rather than `IS NULL` on closed and showed: the Airtable
 * import wrote `false` into both for all 541 rows, so a null test would decide
 * the entire backlog was settled and the list would be empty forever - the
 * same bug in the other direction, and harder to notice.
 */
export function outcomeIsKnown() {
  return sql`(
    ${leads.outcomeLoggedAt} IS NOT NULL
    OR ${leads.postCallRecordId} IS NOT NULL
    OR ${leads.callOutcome} IS NOT NULL
    OR ${leads.closed} IS TRUE
    OR ${leads.showed} IS TRUE
  )`;
}

/** Calls whose time has passed with nothing known about what happened. */
export function awaitingOutcome() {
  return and(
    eq(leads.isTest, false),
    eq(leads.callBooked, true),
    eq(leads.callCancelled, false),
    isNotNull(leads.callScheduledFor),
    // An hour's grace, so a call still in progress isn't already nagging.
    sql`${leads.callScheduledFor} < NOW() - INTERVAL '1 hour'`,
    isNull(leads.outcomeLoggedAt),
    isNull(leads.postCallRecordId),
    isNull(leads.callOutcome),
    sql`${leads.closed} IS NOT TRUE`,
    sql`${leads.showed} IS NOT TRUE`
  );
}
