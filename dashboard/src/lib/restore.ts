import { getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { EXPORTS, type ExportKey } from './exports.ts';
import { parseCsv, unguard } from './csv.ts';

type Db = PostgresJsDatabase<typeof schema>;

export type RestoreStats = {
  table: ExportKey;
  read: number;
  inserted: number;
  skipped: number;
  overwritten: number;
  problems: string[];
};

/**
 * Turns a cell back into whatever the column holds.
 *
 * Driven by the column's own declared type rather than by guessing at the
 * text, so a handle of "12345" stays a string and a numeric column keeps the
 * string form Drizzle wants rather than becoming a float that loses cents.
 */
function toValue(raw: string, dataType: string, columnType: string): unknown {
  const text = unguard(raw);
  if (text === '') return null;

  switch (dataType) {
    case 'number':
      return Number.isFinite(Number(text)) ? Number(text) : null;
    case 'boolean':
      return text === 'true' || text === 't' || text === '1';
    case 'date':
      return Number.isNaN(Date.parse(text)) ? null : new Date(text);
    case 'json':
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    default:
      // Numeric columns are declared as strings on purpose: money read through
      // a float comes back a cent short often enough to matter.
      return columnType === 'PgNumeric' ? text : text;
  }
}

/**
 * Puts a backup file back.
 *
 * Fills gaps by default and never overwrites, which is the same rule the
 * Airtable import follows and the right one here: the usual reason to reach
 * for a restore is that something is missing, and a week-old file dropped over
 * live rows would undo a week of work. `overwrite` is the deliberate choice
 * for the other case - a database that is actually empty.
 */
export async function restoreTable(
  db: Db,
  key: ExportKey,
  csvText: string,
  { overwrite = false, dryRun = false }: { overwrite?: boolean; dryRun?: boolean } = {}
): Promise<RestoreStats> {
  const stats: RestoreStats = { table: key, read: 0, inserted: 0, skipped: 0, overwritten: 0, problems: [] };
  const spec = EXPORTS[key];
  const columns = getTableColumns(spec.table);

  const grid = parseCsv(csvText);
  if (grid.length === 0) {
    stats.problems.push('The file is empty.');
    return stats;
  }

  const header = grid[0].map((h) => unguard(h).trim());
  const known = header.filter((h) => h in columns);
  if (!header.includes('id')) {
    stats.problems.push('No id column, so rows cannot be matched. Is this one of our exports?');
    return stats;
  }
  const unknown = header.filter((h) => !(h in columns));
  if (unknown.length > 0) {
    // Named rather than refused: a file from an older export is still worth
    // restoring, minus the columns that have since been renamed or dropped.
    stats.problems.push(`Ignored columns not in this table: ${unknown.join(', ')}`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    // A blank trailing line is not a row.
    if (line.length === 1 && line[0].trim() === '') continue;
    stats.read += 1;

    if (line.length !== header.length) {
      stats.problems.push(`Line ${r + 1} has ${line.length} cells, expected ${header.length}.`);
      continue;
    }

    const row: Record<string, unknown> = {};
    for (const name of known) {
      const col = columns[name as keyof typeof columns];
      row[name] = toValue(line[header.indexOf(name)], col.dataType, col.columnType);
    }
    if (!row.id) {
      stats.problems.push(`Line ${r + 1} has no id.`);
      continue;
    }
    rows.push(row);
  }

  if (rows.length === 0) return stats;

  // Which ids are already here, so the counts are about what happened rather
  // than about what was attempted.
  const ids = rows.map((r) => String(r.id));
  const present = new Set(
    (
      await db
        .select({ id: spec.table.id })
        .from(spec.table)
        .where(inArray(spec.table.id, ids))
    ).map((r) => r.id)
  );

  const fresh = rows.filter((r) => !present.has(String(r.id)));
  const existing = rows.filter((r) => present.has(String(r.id)));

  stats.inserted = fresh.length;
  stats.skipped = overwrite ? 0 : existing.length;
  stats.overwritten = overwrite ? existing.length : 0;

  if (dryRun) return stats;

  // In batches: one statement with hundreds of rows in it hits the driver's
  // parameter ceiling well before it hits anything else.
  const write = overwrite ? rows : fresh;
  for (let i = 0; i < write.length; i += 200) {
    const batch = write.slice(i, i + 200);
    const q = db.insert(spec.table).values(batch as never);
    if (overwrite) {
      const set = Object.fromEntries(
        known.filter((c) => c !== 'id').map((c) => [c, sqlExcluded(c)])
      );
      await q.onConflictDoUpdate({ target: spec.table.id, set: set as never });
    } else {
      await q.onConflictDoNothing({ target: spec.table.id });
    }
  }

  return stats;
}

// Postgres exposes the row that would have been inserted as `excluded`, which
// is how an upsert says "take the new value" without naming it twice.
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${toSnake(column)}"`);
}

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
