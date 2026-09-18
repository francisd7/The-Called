/**
 * Brings the Airtable Post Call table across.
 *
 * These are not matched to existing leads, because they cannot be: Post Call
 * records a freeform first name, and the two tables cover different periods
 * entirely - the lead tracker's bookings stop on 25 August and Post Call starts
 * on 9 September. The calls it describes were never entered in the tracker at
 * all, so they arrive here as the leads they always should have been, with the
 * outcome already recorded.
 *
 * A name match is still attempted first, in case one happens to line up.
 * Anything created is flagged `needsHandle`, because a Post Call row has no
 * Instagram handle and inventing one that looks real would be worse than saying
 * so.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { leadEvents, leads, users } from '../db/schema.ts';
import * as schema from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

const BASE_ID = process.env.AIRTABLE_EOD_BASE_ID ?? 'appO76t48mwkC3j80';
const TABLE_ID = process.env.AIRTABLE_POST_CALL_TABLE_ID ?? 'tblbMVKMdrdgy9RZq';

const F = {
  leadName: 'fldoKwFzHYAUpXPre',
  date: 'fldNz6hFtSdkT5sFU',
  closer: 'flducCunxzZ08ZJxD',
  setterBooked: 'fldN5bRlNhGA58J33',
  outcome: 'fld79p1lPISYwNRpi',
  payment: 'fldtETT2XDthDXhcb',
  tier: 'fld8vpPRdacNoF4E5',
  cash: 'fldDfGJABBrqos4sQ',
  revenue: 'fldWQ2MDlZDH4HLRL',
  notes: 'fldBvetzSMDYJRAJm',
  fathom: 'fld6E6FpFUUnEZBi9',
} as const;

const OUTCOME_KEYS: Record<string, string> = {
  Closed: 'closed',
  'No Close': 'no_close',
  'No Show': 'no_show',
  Rescheduled: 'rescheduled',
  'Follow Up Scheduled': 'follow_up_scheduled',
};
const SHOWED = new Set(['closed', 'no_close', 'follow_up_scheduled']);

type Cell = string | number | boolean | null | { name?: string };
export type PostCallRecord = { id: string; fields: Record<string, Cell> };
type Rec = PostCallRecord;

function str(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'object') return cell.name?.trim() || null;
  const s = String(cell).trim();
  return s.length > 0 ? s : null;
}

function num(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** "Jacob De Nobriga" -> "jacob_de_nobriga", used as a stand-in handle. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

export type PostCallStats = {
  loaded: number;
  matched: number;
  created: number;
  updated: number;
  dryRun: boolean;
  names: string[];
};

async function fetchRecords(pat: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) throw new Error(`Airtable Post Call read failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { records: Rec[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export async function importPostCall(
  db: Db,
  { pat, records, dryRun = false }: { pat?: string; records?: Rec[]; dryRun?: boolean } = {}
): Promise<PostCallStats> {
  const rows = records ?? (await fetchRecords(pat ?? process.env.AIRTABLE_PAT ?? ''));
  const people = await db.select().from(users);
  const byName = (name: string | null) =>
    name ? (people.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null) : null;

  const stats: PostCallStats = {
    loaded: rows.length,
    matched: 0,
    created: 0,
    updated: 0,
    dryRun,
    names: [],
  };

  for (const rec of rows) {
    const f = rec.fields;
    const name = str(f[F.leadName]);
    if (!name) continue;
    stats.names.push(name);

    const outcomeLabel = str(f[F.outcome]);
    const outcome = outcomeLabel ? (OUTCOME_KEYS[outcomeLabel] ?? null) : null;
    const closed = outcome === 'closed';
    const dateStr = str(f[F.date]);
    const callDate = dateStr ? new Date(`${dateStr}T12:00:00Z`) : null;

    const outcomeFields = {
      callOutcome: outcome,
      showed: outcome ? SHOWED.has(outcome) : null,
      closed,
      closedDate: closed ? callDate : null,
      cashCollected: num(f[F.cash]),
      contractValue: num(f[F.revenue]),
      tier: str(f[F.tier]) === 'No Close' ? null : str(f[F.tier]),
      paymentMethod: str(f[F.payment]) === 'No Close' ? null : str(f[F.payment]),
      postCallNotes: str(f[F.notes]),
      // The Fathom column is freeform and sometimes holds a note rather than a
      // link ("Will add once home"), so only real URLs are stored as one.
      fathomUrl: str(f[F.fathom])?.startsWith('http') ? str(f[F.fathom]) : null,
      closerName: str(f[F.closer]),
      closerId: byName(str(f[F.closer])),
      postCallRecordId: rec.id,
      outcomeLoggedAt: new Date(),
      updatedAt: new Date(),
    };

    if (dryRun) {
      stats.created += 1;
      continue;
    }

    // Already imported? Update in place rather than creating a second copy.
    const existingByRec = await db.query.leads.findFirst({
      where: eq(leads.postCallRecordId, rec.id),
      columns: { id: true },
    });
    if (existingByRec) {
      await db.update(leads).set(outcomeFields).where(eq(leads.id, existingByRec.id));
      stats.updated += 1;
      continue;
    }

    // A name match is a long shot, but free to try.
    const match = await db.query.leads.findFirst({
      where: sql`LOWER(${leads.name}) = ${name.toLowerCase()} OR ${leads.igHandleKey} = ${slug(name)}`,
      columns: { id: true },
    });

    if (match) {
      await db.update(leads).set(outcomeFields).where(eq(leads.id, match.id));
      await db.insert(leadEvents).values({
        leadId: match.id,
        type: 'call_outcome',
        toValue: outcome,
        meta: { source: 'airtable_post_call' },
      });
      stats.matched += 1;
      continue;
    }

    const [created] = await db
      .insert(leads)
      .values({
        igHandle: name,
        igHandleKey: slug(name),
        name,
        // No handle exists on a Post Call row. Flagged rather than faked.
        needsHandle: true,
        setterId: byName(str(f[F.setterBooked])),
        conversationStage: closed ? 'closed' : 'business_talk',
        callBooked: true,
        callBookedAt: callDate,
        callScheduledFor: callDate,
        responded: true,
        // Rapport carries on after a call, so these stay live conversations.
        isActiveConvo: true,
        leadCreatedAt: callDate ?? new Date(),
        lastContactAt: callDate,
        ...outcomeFields,
      })
      .returning({ id: leads.id });

    await db.insert(leadEvents).values({
      leadId: created.id,
      type: 'call_outcome',
      toValue: outcome,
      meta: { source: 'airtable_post_call', createdFromPostCall: true },
    });
    stats.created += 1;
  }

  return stats;
}
