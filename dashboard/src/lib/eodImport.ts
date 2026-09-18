/**
 * Brings the Airtable "Setter EOD" form across.
 *
 * Unlike the post-call form, these rows say who filed them, so they need no
 * queue and no guessing: the setter name is a fixed dropdown that matches the
 * people already in the users table.
 *
 * A report filed in the dashboard always wins. Airtable is history here, and
 * overwriting something somebody typed in the app with an older row from a form
 * being retired would be the wrong way round.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eodReports, users } from '../db/schema.ts';
import * as schema from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

const BASE_ID = process.env.AIRTABLE_EOD_BASE_ID ?? 'appO76t48mwkC3j80';
const TABLE_ID = process.env.AIRTABLE_SETTER_EOD_TABLE_ID ?? 'tblAOPJioGyBRliH4';

const F = {
  date: 'fld5jDWoKb2orZTuD',
  setter: 'fld2OkCwwD0HxibqE',
  outbounds: 'fldiudXyCCIQDmfym',
  followUps: 'fldzJSgz0TAaXspgY',
  replies: 'fldGk6fkHOkfSCma8',
  youtube: 'fld2BDYFLt3nPxHf7',
  pitched: 'fldo3Hvj53CilDZEW',
  booked: 'fld0yA6kmb1Meyddb',
  cash: 'fld3Gn3Neox6wmMje',
  revenue: 'fldZ3EmnqF9E1HY6r',
  updatedTracker: 'fldm1lbxMrR3CBCTM',
  win: 'fldM2gOS4yLP14c08',
  obstacle: 'fldkD5tccdaSnDq1R',
  focus: 'fldwfNVOc2ZyGA7tU',
  notes: 'fldCORtBIv5bwsd2x',
} as const;

type Cell = string | number | boolean | null | { name?: string };
export type EodRecord = { id: string; fields: Record<string, Cell> };

function str(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'object') return cell.name?.trim() || null;
  const s = String(cell).trim();
  return s.length > 0 ? s : null;
}

/** A blank cell stays blank. Zero is an answer; missing is not. */
function int(cell: Cell | undefined): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function money(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

export type EodImportStats = {
  loaded: number;
  inserted: number;
  updated: number;
  /** Already filed in the dashboard for that day, so left exactly as it was. */
  keptDashboard: number;
  /** No date, or a setter name that matches nobody. */
  skipped: string[];
  dryRun: boolean;
};

async function fetchRecords(pat: string): Promise<EodRecord[]> {
  const out: EodRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) {
      throw new Error(`Airtable Setter EOD read failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { records: EodRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export async function importSetterEod(
  db: Db,
  { pat, records, dryRun = false }: { pat?: string; records?: EodRecord[]; dryRun?: boolean } = {}
): Promise<EodImportStats> {
  const rows = records ?? (await fetchRecords(pat ?? process.env.AIRTABLE_PAT ?? ''));
  const people = await db.select().from(users);
  const byName = (name: string | null) =>
    name ? (people.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null) : null;

  const stats: EodImportStats = {
    loaded: rows.length,
    inserted: 0,
    updated: 0,
    keptDashboard: 0,
    skipped: [],
    dryRun,
  };

  for (const rec of rows) {
    const f = rec.fields;
    const reportDate = str(f[F.date]);
    const setterName = str(f[F.setter]);
    const userId = byName(setterName);

    if (!reportDate || !userId) {
      stats.skipped.push(
        !reportDate ? `${rec.id}: no date` : `${rec.id}: no one here is called ${setterName}`
      );
      continue;
    }

    const tracker = str(f[F.updatedTracker]);
    const values = {
      userId,
      reportDate,
      totalOutbounds: int(f[F.outbounds]),
      totalFollowUps: int(f[F.followUps]),
      totalLeadsWithReplies: int(f[F.replies]),
      youtubeVideosSent: int(f[F.youtube]),
      callsPitched: int(f[F.pitched]),
      callsBooked: int(f[F.booked]),
      cashCollected: money(f[F.cash]),
      revenueGenerated: money(f[F.revenue]),
      win: str(f[F.win]),
      obstacle: str(f[F.obstacle]),
      focusTomorrow: str(f[F.focus]),
      notes: str(f[F.notes]),
      airtableRecordId: rec.id,
      legacy: tracker ? ({ saidUpdatedTracker: tracker } as never) : null,
      updatedAt: new Date(),
    };

    const existing = await db.query.eodReports.findFirst({
      where: eq(eodReports.airtableRecordId, rec.id),
      columns: { id: true },
    });
    if (existing) {
      if (!dryRun) await db.update(eodReports).set(values).where(eq(eodReports.id, existing.id));
      stats.updated += 1;
      continue;
    }

    // Somebody already filed this day in the dashboard. Theirs stands.
    const filedHere = await db.query.eodReports.findFirst({
      where: and(
        eq(eodReports.userId, userId),
        eq(eodReports.reportDate, reportDate),
        isNull(eodReports.airtableRecordId)
      ),
      columns: { id: true },
    });
    if (filedHere) {
      stats.keptDashboard += 1;
      continue;
    }

    if (dryRun) {
      stats.inserted += 1;
      continue;
    }

    // Only one report per person per day. Two Airtable rows for the same day
    // would otherwise take the whole import down on a unique violation, so the
    // second is reported rather than thrown.
    const [written] = await db
      .insert(eodReports)
      .values(values)
      .onConflictDoNothing({ target: [eodReports.userId, eodReports.reportDate] })
      .returning({ id: eodReports.id });

    if (written) stats.inserted += 1;
    else stats.skipped.push(`${rec.id}: ${setterName} already has a report for ${reportDate}`);
  }

  return stats;
}
