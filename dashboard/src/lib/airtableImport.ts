/**
 * Brings the Airtable lead tracker into Postgres. Idempotent: rows are keyed on
 * their Airtable record id, so re-running updates rather than duplicating.
 *
 * `db` is passed in rather than imported so this runs both inside the app (from
 * the admin screen) and against a throwaway database in tests.
 *
 * Every Airtable field is either mapped to a column or stashed in `legacy`, so
 * nothing in the tracker is dropped.
 *
 * The tracker is no longer the only source: Calendly owns the bookings and the
 * Post Call form owns the outcomes. So this fills blanks and never clears -
 * see the note above `importAirtableLeads` for what that means per column.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { leadNotes, leads, optionSets, users } from '../db/schema.ts';
import * as schema from '../db/schema.ts';
import { normalizeIgHandle } from './calendly.ts';
import { respondedFromStage } from './stages.ts';

type Db = PostgresJsDatabase<typeof schema>;

const BASE_ID = process.env.AIRTABLE_LEAD_BASE_ID ?? 'appdiKhhb3Y8zkUdT';
const TABLE_ID = process.env.AIRTABLE_LEAD_TABLE_ID ?? 'tblAn2LtRitBgKGDX';

const F = {
  igHandle: 'fldHIn51ACE4y793J',
  leadCreated: 'fldF0joEuTE5Odfhi',
  setter: 'fldead1TzzGGrTJRl',
  conversationStage: 'fldHblRu88jWT9q36',
  leadSource: 'fldae8xGCiKu5YGsY',
  analyticsStage: 'fldMwdVgwerxLqgbp',
  leadQuality: 'fldEHay09inXFSBTd',
  opener: 'fldmQTeZpKBTurLn9',
  icp: 'fldOJWnZt2MG5hQM9',
  responded: 'fldOtUSwvRWYihtvp',
  responseDate: 'fld7uAA7Lc0PudAL1',
  sourceContent: 'fldyisAraZWzwgH12',
  followUps: 'fldDM5qQMgaUc9dfv',
  notes: 'fldpVwLWtniEKmQcD',
  lastContact: 'fldhChYCvV8cnwmPL',
  nextFollowUp: 'fldLyn92vCrKzYBeQ',
  callBooked: 'fldrjHfOXzIawwzXi',
  callBookedDate: 'fldQlbNh9tc1DdHgq',
  callCancelled: 'fldKIXUz1eC8mGiUt',
  cancelReason: 'fldyipth4gSrRVlZW',
  showed: 'fldYlJ9dRI4nzMZ5h',
  showDate: 'fldFoaJrt0uTyRS3X',
  qualified: 'fldNPoKzNHlbYAVQH',
  closed: 'fldW7oLHrZLIDecLA',
  closedDate: 'fldvnS86GNGLCcM9a',
  cashCollected: 'fldiOBSr2CqA8vuyQ',
  contractValue: 'fldTrFIhEHzUQMY05',
  lostReason: 'fld8JBrO5AkW3QbXc',
  postCallNotes: 'fldytriet5zhC4BXA',
  outboundDm: 'fldF0TrL7ZOFyEd5R',
} as const;

const MAPPED_FIELD_IDS = new Set<string>(Object.values(F));

/**
 * Stages that mean the conversation is over. Used ONCE, on import, to give the
 * manual "active conversation" flag a sensible starting point - without it
 * every one of the 541 imported leads would arrive unticked and somebody would
 * have to work through the lot by hand. After import the flag is only ever
 * changed by a person.
 */
const DEAD_STAGES = new Set([
  'dq',
  'bad_fit',
  'no_response',
  'no_money',
  'closed',
  'declined_call',
  'lost_ghosted',
  'nurture',
  'ltfu',
  'not_outreached',
]);

type Cell = string | number | boolean | null | { id?: string; name?: string };
type AirtableRecord = { id: string; createdTime?: string; cellValuesByFieldId: Record<string, Cell> };

/** Airtable returns a select as {id,name}; everything else comes through raw. */
function str(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'object') {
    const name = cell.name?.trim();
    return name && name.length > 0 ? name : null;
  }
  const s = String(cell).trim();
  return s.length > 0 ? s : null;
}

function bool(cell: Cell | undefined): boolean {
  return cell === true;
}

function num(cell: Cell | undefined): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

function date(cell: Cell | undefined): Date | null {
  const s = str(cell);
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Mid Rapport Seen" -> "mid_rapport_seen", matching the option_sets keys. */
function optionKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fetchFromAirtable(pat: string): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) throw new Error(`Airtable list failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as {
      records: Array<{ id: string; createdTime: string; fields: Record<string, Cell> }>;
      offset?: string;
    };
    for (const r of data.records) {
      out.push({ id: r.id, createdTime: r.createdTime, cellValuesByFieldId: r.fields });
    }
    offset = data.offset;
  } while (offset);
  return out;
}

async function loadRecords(fromFile: string | null, pat?: string): Promise<AirtableRecord[]> {
  if (fromFile) {
    const { readFile } = await import('node:fs/promises');
    const parsed = JSON.parse(await readFile(fromFile, 'utf8'));
    return parsed.records as AirtableRecord[];
  }
  const token = pat ?? process.env.AIRTABLE_PAT;
  if (!token) throw new Error('AIRTABLE_PAT is not set');
  return fetchFromAirtable(token);
}

export type ImportOptions = { pat?: string; fromFile?: string | null; dryRun?: boolean };
export type ImportStats = {
  loaded: number;
  inserted: number;
  updated: number;
  /** Tracker rows matched to a lead Calendly or a Post Call report created first. */
  adopted: number;
  notes: number;
  options: number;
  noSetter: number;
  blankHandle: number;
  /** Leads whose booking the tracker would have cleared, and didn't. */
  bookingsKept: number;
  /** Leads whose outcome the tracker would have cleared, and didn't. */
  outcomesKept: number;
  dryRun: boolean;
};

/**
 * Columns the tracker no longer owns.
 *
 * When Airtable was the only record of anything, the import could write every
 * column and be right. It isn't any more. Calendly books the calls and the Post
 * Call form records what happened on them, and both know things the tracker
 * never will - it holds no booking at all after 25 August. Writing its blanks
 * over the top would roll those back, and only half way: callOutcome and
 * postCallRecordId have no Airtable field, so a lead would come out of the
 * import still linked to a report that says it closed while its own closed
 * column reads false.
 *
 * So the import fills blanks and never clears. A tracker row writes a booking
 * only when it has one, and never over Calendly's; it writes an outcome only
 * when it has one, and never over a Post Call report's. A lead the tracker
 * alone knows about is imported exactly as it always was.
 */
type Existing = {
  id: string;
  conversationStage: string | null;
  callBooked: boolean;
  callScheduledFor: Date | null;
  calendlyEventUri: string | null;
  closed: boolean | null;
  showed: boolean | null;
  outcomeLoggedAt: Date | null;
  postCallRecordId: string | null;
};

const EXISTING_COLUMNS = {
  id: true,
  conversationStage: true,
  callBooked: true,
  callScheduledFor: true,
  calendlyEventUri: true,
  closed: true,
  showed: true,
  outcomeLoggedAt: true,
  postCallRecordId: true,
} as const;

/**
 * Whether the dashboard already knows this call happened.
 *
 * Deliberately not "is the column non-null": the first import wrote `false`
 * into closed and showed for all 541 rows, so a null test would decide every
 * lead was already settled and the tracker could never report a close again.
 * Only a yes, or an outcome some other part of the dashboard recorded, counts.
 */
function leadHasBooking(lead: Existing): boolean {
  // calendlyEventUri is redundant against the two beside it today - a cancelled
  // booking keeps both - but it is the column that actually says "Calendly owns
  // this", and it costs nothing to say so here rather than rely on that.
  return lead.callBooked || lead.callScheduledFor !== null || lead.calendlyEventUri !== null;
}

function leadHasOutcome(lead: Existing): boolean {
  return (
    lead.closed === true ||
    lead.showed === true ||
    lead.postCallRecordId !== null ||
    lead.outcomeLoggedAt !== null
  );
}

export async function importAirtableLeads(
  db: Db,
  { pat, fromFile = null, dryRun = false }: ImportOptions = {}
): Promise<ImportStats> {
  const records = await loadRecords(fromFile, pat);

  const setterRows = await db.select().from(users);
  const setterByName = new Map(setterRows.map((u) => [u.name.toLowerCase(), u.id]));

  // The dropdowns are built from what the data actually uses, not from
  // Airtable's full choice lists - Opener alone has ~50 options, most dead.
  const seenOptions = new Map<string, Map<string, string>>();
  const noteOption = (kind: string, label: string | null) => {
    if (!label) return null;
    const key = optionKey(label);
    if (!key) return null;
    if (!seenOptions.has(kind)) seenOptions.set(kind, new Map());
    seenOptions.get(kind)!.set(key, label);
    return key;
  };

  const stats = {
    inserted: 0,
    updated: 0,
    adopted: 0,
    notes: 0,
    noSetter: 0,
    blankHandle: 0,
    bookingsKept: 0,
    outcomesKept: 0,
  };

  for (const rec of records) {
    const c = rec.cellValuesByFieldId;
    const rawHandle = str(c[F.igHandle]);
    if (!rawHandle) stats.blankHandle += 1;
    const handleKey = normalizeIgHandle(rawHandle);

    const setterName = str(c[F.setter]);
    const setterId = setterName ? (setterByName.get(setterName.toLowerCase()) ?? null) : null;
    if (setterName && !setterId) stats.noSetter += 1;

    // Anything without a column of its own is preserved verbatim rather than
    // discarded - Analytics Stage is the main one.
    const legacy: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(c)) {
      if (!MAPPED_FIELD_IDS.has(fieldId)) legacy[fieldId] = value;
    }
    const analyticsStage = str(c[F.analyticsStage]);
    if (analyticsStage) legacy.analyticsStage = analyticsStage;

    const stage = noteOption('conversation_stage', str(c[F.conversationStage]));

    /** What the tracker still owns: the conversation itself. */
    const conversation = {
      igHandle: rawHandle ?? '(no handle)',
      igHandleKey: handleKey,
      setterId,
      leadSource: noteOption('lead_source', str(c[F.leadSource])),
      opener: noteOption('opener', str(c[F.opener])),
      conversationStage: stage,
      leadQuality: noteOption('lead_quality', str(c[F.leadQuality])),
      icp: noteOption('icp', str(c[F.icp])),
      sourceContent: str(c[F.sourceContent]),
      outboundDm: bool(c[F.outboundDm]),
      // The stage is the field setters maintain; Responded is the one they
      // forget - 79 ticks against 68 booked calls. Where the stage settles the
      // question it wins, which is the rule migration 0015 applied to the rows
      // already here. Applying it on every import means new rows arrive with it
      // too, instead of drifting back apart until somebody runs another one.
      responded: respondedFromStage(stage) ?? bool(c[F.responded]),
      respondedAt: date(c[F.responseDate]),
      followUps: num(c[F.followUps]) ?? 0,
      lastContactAt: date(c[F.lastContact]),
      nextFollowUpAt: date(c[F.nextFollowUp]),
      lostReason: noteOption('lost_reason', str(c[F.lostReason])),
      leadCreatedAt:
        date(c[F.leadCreated]) ?? (rec.createdTime ? new Date(rec.createdTime) : new Date()),
      airtableRecordId: rec.id,
      legacy: Object.keys(legacy).length > 0 ? legacy : null,
      updatedAt: new Date(),
    };

    // Airtable's "Call Booked Date" is read as the day the booking was made;
    // "Show Date" is the day the call actually happened, which is the closest
    // thing the old data has to a scheduled time. Going forward Calendly fills
    // both properly and neither is inferred.
    const booking = {
      callBooked: bool(c[F.callBooked]),
      callBookedAt: date(c[F.callBookedDate]),
      callScheduledFor: date(c[F.showDate]),
      callCancelled: bool(c[F.callCancelled]),
      cancelReason: noteOption('cancel_reason', str(c[F.cancelReason])),
    };

    const outcome = {
      showed: bool(c[F.showed]),
      qualified: bool(c[F.qualified]),
      closed: bool(c[F.closed]),
      closedDate: date(c[F.closedDate]),
      cashCollected: num(c[F.cashCollected])?.toFixed(2) ?? null,
      contractValue: num(c[F.contractValue])?.toFixed(2) ?? null,
      postCallNotes: str(c[F.postCallNotes]),
    };

    const trackerHasBooking =
      booking.callBooked || booking.callBookedAt !== null || booking.callScheduledFor !== null;
    const trackerHasOutcome =
      outcome.closed ||
      outcome.showed ||
      outcome.closedDate !== null ||
      outcome.cashCollected !== null ||
      outcome.contractValue !== null ||
      outcome.postCallNotes !== null;

    let existing = (await db.query.leads.findFirst({
      where: eq(leads.airtableRecordId, rec.id),
      columns: EXISTING_COLUMNS,
    })) as Existing | undefined;

    // The Calendly backfill and the Post Call queue both create leads the
    // tracker has never seen. When a setter later types that same person into
    // Airtable, matching on the handle joins the two rows instead of leaving a
    // second copy of somebody who already has a booking against their name.
    // Only a lead no other tracker row has claimed is eligible, and only when
    // there is exactly one of them: two candidates is a guess, and a guess here
    // welds two real people together.
    let adopting = false;
    if (!existing && handleKey) {
      const candidates = (await db.query.leads.findMany({
        where: and(
          eq(leads.igHandleKey, handleKey),
          isNull(leads.airtableRecordId),
          eq(leads.isTest, false)
        ),
        columns: EXISTING_COLUMNS,
        limit: 2,
      })) as Existing[];
      if (candidates.length === 1) {
        existing = candidates[0];
        adopting = true;
      }
    }

    let leadId: string;
    if (existing) {
      // The tracker fills gaps and never overwrites. It writes a booking only
      // where the dashboard has none, and an outcome only where nothing has
      // recorded one - so a setter's tick still reaches a lead nobody else
      // knows about, and never lands on top of Calendly or a post-call report.
      const keepBooking = leadHasBooking(existing);
      const keepOutcome = leadHasOutcome(existing);
      // Only worth reporting where the tracker would actually have changed
      // something: a blank row over a blank lead clears nothing.
      if (keepBooking && !trackerHasBooking) stats.bookingsKept += 1;
      if (keepOutcome && !trackerHasOutcome) stats.outcomesKept += 1;

      // A re-import must not undo work done in the dashboard. isActiveConvo is
      // never in the update at all, and ownership fields are dropped when
      // Airtable has nothing to say about them - most imported rows have no
      // setter, so writing the null through would silently unassign every lead
      // anyone had claimed or been given since the last run.
      const { setterId: airtableSetter, ...rest } = conversation;
      const update = {
        ...rest,
        ...(airtableSetter ? { setterId: airtableSetter } : {}),
        ...(keepBooking ? {} : booking),
        ...(keepOutcome ? {} : outcome),
        // A lead the dashboard has marked closed doesn't walk back to "mid
        // rapport" because nobody updated the tracker afterwards.
        ...(existing.conversationStage === 'closed' ? { conversationStage: 'closed' } : {}),
        ...(adopting ? { needsHandle: false } : {}),
      };

      if (!dryRun) await db.update(leads).set(update).where(eq(leads.id, existing.id));
      leadId = existing.id;
      if (adopting) stats.adopted += 1;
      else stats.updated += 1;
    } else {
      // Nothing to protect on a lead that doesn't exist yet, so the tracker
      // writes all of it.
      const values = {
        ...conversation,
        ...booking,
        ...outcome,
        isActiveConvo: stage !== null && stage !== '' && !DEAD_STAGES.has(stage),
      };
      stats.inserted += 1;
      if (dryRun) continue;
      const [row] = await db.insert(leads).values(values).returning({ id: leads.id });
      leadId = row.id;
    }

    if (dryRun) continue;

    // The single Airtable Notes blob becomes the first entry in the lead's
    // thread, attributed to nobody because Airtable never recorded an author.
    const noteBody = str(c[F.notes]);
    if (noteBody) {
      const already = await db.query.leadNotes.findFirst({
        where: eq(leadNotes.leadId, leadId),
        columns: { id: true },
      });
      if (!already) {
        await db.insert(leadNotes).values({ leadId, authorId: null, body: noteBody });
        stats.notes += 1;
      }
    }
  }

  let optionCount = 0;
  if (!dryRun) {
    for (const [kind, options] of seenOptions) {
      let i = 100;
      for (const [value, label] of options) {
        await db
          .insert(optionSets)
          .values({ kind, value, label, sortOrder: i++ })
          .onConflictDoNothing();
        optionCount += 1;
      }
    }
  }

  return { loaded: records.length, options: optionCount, dryRun, ...stats };
}
