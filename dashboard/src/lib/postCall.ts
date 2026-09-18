/**
 * The Airtable post-call form, brought across as a queue rather than as data.
 *
 * A report says "Gavin", "Closed", "$5,000" and nothing else that identifies
 * anybody. There is no handle, no email, and first names collide - so the app
 * doesn't guess. Each report is stored as it came in and waits on the dashboard
 * until a person points it at the lead it belongs to.
 *
 * Nothing here writes to a lead on its own. `applyToLead` does, and it only
 * runs when somebody has chosen a lead, or when a report that was already
 * linked changes in Airtable.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { leadEvents, leads, postCallReports, users } from '../db/schema.ts';
import * as schema from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Report = typeof postCallReports.$inferSelect;

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
/** The outcomes that mean the lead turned up. A reschedule or no-show didn't. */
const SHOWED = new Set(['closed', 'no_close', 'follow_up_scheduled']);

export const OUTCOME_LABELS: Record<string, string> = {
  closed: 'Closed',
  no_close: 'No close',
  no_show: 'No show',
  rescheduled: 'Rescheduled',
  follow_up_scheduled: 'Follow up scheduled',
};

type Cell = string | number | boolean | null | { name?: string };
export type PostCallRecord = { id: string; fields: Record<string, Cell> };

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

/** "Jacob De Nobriga" -> "jacob_de_nobriga", a stand-in until a handle is known. */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

type Mapped = {
  airtableRecordId: string;
  leadName: string;
  callDate: Date | null;
  closerName: string | null;
  setterName: string | null;
  outcome: string | null;
  tier: string | null;
  paymentMethod: string | null;
  cashCollected: string | null;
  contractValue: string | null;
  notes: string | null;
  fathomUrl: string | null;
  fingerprint: string;
};

/**
 * One Airtable row, turned into the shape the queue stores.
 *
 * Two quirks of the live data are handled here rather than downstream. Tier and
 * Payment Method hold the literal string "No Close" on a call that didn't
 * close, which is not a tier and not a payment method; and the Fathom column is
 * freeform, so it sometimes holds a note ("Will add once home") where a link
 * should be.
 */
export function mapRecord(rec: PostCallRecord): Mapped | null {
  const f = rec.fields;
  const leadName = str(f[F.leadName]);
  if (!leadName) return null;

  const outcomeLabel = str(f[F.outcome]);
  const dateStr = str(f[F.date]);
  const tier = str(f[F.tier]);
  const payment = str(f[F.payment]);
  const fathom = str(f[F.fathom]);

  const mapped = {
    airtableRecordId: rec.id,
    leadName,
    callDate: dateStr ? new Date(`${dateStr}T12:00:00Z`) : null,
    closerName: str(f[F.closer]),
    setterName: str(f[F.setterBooked]),
    outcome: outcomeLabel ? (OUTCOME_KEYS[outcomeLabel] ?? null) : null,
    tier: tier === 'No Close' ? null : tier,
    paymentMethod: payment === 'No Close' ? null : payment,
    cashCollected: num(f[F.cash]),
    contractValue: num(f[F.revenue]),
    notes: str(f[F.notes]),
    fathomUrl: fathom?.startsWith('http') ? fathom : null,
  };

  return {
    ...mapped,
    fingerprint: [
      mapped.leadName,
      dateStr ?? '',
      mapped.closerName ?? '',
      mapped.setterName ?? '',
      mapped.outcome ?? '',
      mapped.tier ?? '',
      mapped.paymentMethod ?? '',
      mapped.cashCollected ?? '',
      mapped.contractValue ?? '',
      mapped.notes ?? '',
      mapped.fathomUrl ?? '',
    ].join('|'),
  };
}

async function fetchRecords(pat: string): Promise<PostCallRecord[]> {
  const out: PostCallRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) {
      throw new Error(`Airtable Post Call read failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { records: PostCallRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export type SyncStats = {
  loaded: number;
  added: number;
  changed: number;
  reapplied: number;
  pending: number;
};

/**
 * Pulls every post-call form across and files it.
 *
 * New reports arrive pending. One already linked to a lead is left alone unless
 * the closer edited it in Airtable, in which case the edit is pushed onto the
 * lead - while the Airtable form is still the one closers fill in, it is the
 * truth about what happened on the call.
 */
export async function syncPostCallReports(
  db: Db,
  { pat, records }: { pat?: string; records?: PostCallRecord[] } = {}
): Promise<SyncStats> {
  const rows = records ?? (await fetchRecords(pat ?? process.env.AIRTABLE_PAT ?? ''));
  const stats: SyncStats = { loaded: 0, added: 0, changed: 0, reapplied: 0, pending: 0 };

  for (const rec of rows) {
    const mapped = mapRecord(rec);
    if (!mapped) continue;
    stats.loaded += 1;

    const existing = await db.query.postCallReports.findFirst({
      where: eq(postCallReports.airtableRecordId, mapped.airtableRecordId),
    });

    if (!existing) {
      // An earlier version of this import wrote Post Call rows straight onto
      // leads. Where it did, the report arrives already linked rather than
      // asking somebody to place a call that's been placed.
      const priorLead = await db.query.leads.findFirst({
        where: eq(leads.postCallRecordId, mapped.airtableRecordId),
        columns: { id: true, needsHandle: true },
      });

      await db
        .insert(postCallReports)
        .values({
          ...mapped,
          fetchedAt: new Date(),
          ...(priorLead
            ? {
                status: 'linked' as const,
                leadId: priorLead.id,
                leadWasCreated: priorLead.needsHandle,
                linkedAt: new Date(),
              }
            : {}),
        })
        // Two people opening the dashboard at once both trigger a sync. The
        // second one finding the row already there is normal, not a failure.
        .onConflictDoNothing({ target: postCallReports.airtableRecordId });
      stats.added += 1;
      if (!priorLead) stats.pending += 1;
      continue;
    }

    if (existing.fingerprint === mapped.fingerprint) {
      await db
        .update(postCallReports)
        .set({ fetchedAt: new Date() })
        .where(eq(postCallReports.id, existing.id));
      continue;
    }

    await db
      .update(postCallReports)
      .set({ ...mapped, fetchedAt: new Date() })
      .where(eq(postCallReports.id, existing.id));
    stats.changed += 1;

    if (existing.status === 'linked' && existing.leadId) {
      await applyToLead(db, { report: { ...existing, ...mapped }, leadId: existing.leadId });
      stats.reapplied += 1;
    }
  }

  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(postCallReports)
    .where(eq(postCallReports.status, 'pending'));
  stats.pending = n;

  return stats;
}

/**
 * Writes a report's answers onto a lead.
 *
 * Also backfills the booking when the lead hasn't got one. A report only exists
 * because a call happened, so a lead with no call on it is a lead whose booking
 * never got entered - which is exactly the gap these reports are here to close.
 */
export async function applyToLead(
  db: Db,
  {
    report,
    leadId,
    actorId,
  }: { report: Omit<Report, 'id' | 'status' | 'createdAt'> & { id?: string }; leadId: string; actorId?: string }
) {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) throw new Error('Lead not found');

  const closerId = report.closerName
    ? ((
        await db.query.users.findFirst({
          where: sql`LOWER(${users.name}) = ${report.closerName.toLowerCase()}`,
          columns: { id: true },
        })
      )?.id ?? null)
    : null;

  const closed = report.outcome === 'closed';

  // Only one lead can carry a given report. If another still does - it was
  // linked to the wrong person and is being moved - let that one go first,
  // rather than colliding on the way in.
  await db
    .update(leads)
    .set({ postCallRecordId: null })
    .where(and(eq(leads.postCallRecordId, report.airtableRecordId), ne(leads.id, leadId)));

  await db
    .update(leads)
    .set({
      callOutcome: report.outcome,
      showed: report.outcome ? SHOWED.has(report.outcome) : null,
      closed,
      closedDate: closed ? (report.callDate ?? new Date()) : null,
      cashCollected: report.cashCollected,
      contractValue: report.contractValue,
      tier: report.tier,
      paymentMethod: report.paymentMethod,
      postCallNotes: report.notes,
      fathomUrl: report.fathomUrl,
      closerName: report.closerName ?? lead.closerName,
      closerId: closerId ?? lead.closerId,
      postCallRecordId: report.airtableRecordId,
      outcomeLoggedAt: new Date(),
      outcomeLoggedById: actorId ?? lead.outcomeLoggedById,
      // The call plainly happened, so fill in whatever nobody recorded at the
      // time. Anything already there is left alone - a Calendly booking knows
      // the hour, and the report only knows the day.
      ...(lead.callBooked && lead.callScheduledFor
        ? {}
        : {
            callBooked: true,
            callBookedAt: lead.callBookedAt ?? report.callDate,
            callScheduledFor: lead.callScheduledFor ?? report.callDate,
            responded: true,
          }),
      ...(closed && lead.conversationStage !== 'closed' ? { conversationStage: 'closed' } : {}),
      // isActiveConvo is deliberately untouched. Rapport carries on after a
      // call, so an outcome is never the signal that a conversation is over.
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await db.insert(leadEvents).values({
    leadId,
    actorId: actorId ?? null,
    type: 'call_outcome',
    toValue: report.outcome,
    meta: { source: 'post_call_report', reportId: report.id ?? null } as never,
  });
}
