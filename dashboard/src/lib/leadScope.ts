import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { leads } from "../db/schema.ts";

/**
 * The leads anybody is meant to see: not a test row, not archived.
 *
 * One predicate rather than the same pair of conditions written out at every
 * call site, because the failure mode of a soft delete is a query somebody
 * forgot - an archived lead that still shows up in one list, or still counts
 * towards one figure, is worse than no archive at all. Anything that reports a
 * number or renders a list uses this.
 *
 * Two things deliberately do NOT use it, and say so where they are: the
 * Airtable import and the Calendly backfill both look a lead up to decide
 * whether it already exists. They have to see archived rows, or the next
 * import would create a fresh copy of the very lead somebody archived - and
 * it would come back without the notes. Post-call matching is not one of
 * them; it uses this, because a report should never be filed against a lead
 * somebody has said is not real.
 */
export const liveLead = and(eq(leads.isTest, false), isNull(leads.archivedAt));

/** Archived only, for the one screen that lists them to put them back. */
export const archivedLead = and(
  eq(leads.isTest, false),
  isNotNull(leads.archivedAt),
);

/**
 * Not archived, and nothing said about test rows.
 *
 * The call queries want this rather than liveLead. A test booking is meant to
 * show up in Calls today - that is the whole point of "Try it without telling
 * anyone", and CallTile badges it TEST precisely because it renders there
 * beside the real ones. Using liveLead here quietly took the test flow away.
 */
export const notArchived = isNull(leads.archivedAt);
