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
 * Three things deliberately do NOT use it, and say so where they are: the
 * Airtable import, the Calendly backfill and post-call matching all look a
 * lead up to decide whether it already exists. They have to see archived rows,
 * or the next import would create a fresh copy of the very lead somebody
 * archived - and it would come back without the notes.
 */
export const liveLead = and(eq(leads.isTest, false), isNull(leads.archivedAt));

/** Archived only, for the one screen that lists them to put them back. */
export const archivedLead = and(
  eq(leads.isTest, false),
  isNotNull(leads.archivedAt),
);
