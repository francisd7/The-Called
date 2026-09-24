import { desc, getTableColumns, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { boostedReels, eodReports, leads, postCallReports, users } from '../db/schema.ts';
import { toCsv } from './csv.ts';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The tables worth taking a copy of, in the order they have to go back in.
 *
 * One list, used by the download links and by the weekly backup, so a table
 * added to one is never missing from the other - a backup quietly short of a
 * table is the kind of thing you find out about on the day it matters.
 *
 * People come first because leads point at them: restoring a lead whose setter
 * does not exist yet fails on the foreign key.
 */
export const EXPORTS = {
  people: { table: users, order: () => asc(users.name), label: 'people' },
  leads: { table: leads, order: () => desc(leads.createdAt), label: 'leads' },
  eod: { table: eodReports, order: () => desc(eodReports.reportDate), label: 'eod-reports' },
  'post-call': {
    table: postCallReports,
    order: () => desc(postCallReports.createdAt),
    label: 'post-call-reports',
  },
  reels: { table: boostedReels, order: () => desc(boostedReels.createdAt), label: 'boosted-reels' },
} as const;

export type ExportKey = keyof typeof EXPORTS;

/** Restore order. Reversed, it is also a safe order to empty them in. */
export const EXPORT_ORDER: ExportKey[] = ['people', 'leads', 'eod', 'post-call', 'reels'];

export function isExportKey(v: string): v is ExportKey {
  return Object.prototype.hasOwnProperty.call(EXPORTS, v);
}

export async function buildCsv(db: Db, key: ExportKey): Promise<string> {
  const spec = EXPORTS[key];
  const rows = await db.select().from(spec.table).orderBy(spec.order());
  // Columns off the schema, not the first row, so an empty table still exports
  // its header rather than a blank file that reads as broken.
  const columns = Object.keys(getTableColumns(spec.table));
  return toCsv(columns, rows as Array<Record<string, unknown>>);
}

export function fileNameFor(key: ExportKey, on = new Date()): string {
  return `the-called-${EXPORTS[key].label}-${on.toISOString().slice(0, 10)}.csv`;
}
