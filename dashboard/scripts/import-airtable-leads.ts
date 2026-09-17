/**
 * Brings the Airtable lead tracker into Postgres. Idempotent: rows are keyed on
 * their Airtable record id, so re-running updates rather than duplicating.
 *
 *   AIRTABLE_PAT=... node --experimental-strip-types scripts/import-airtable-leads.ts
 *   node --experimental-strip-types scripts/import-airtable-leads.ts --from-file snapshot.json
 *   ... --dry-run     # report what would happen, write nothing
 *
 * Every Airtable field is either mapped to a column or stashed in `legacy`, so
 * nothing in the tracker is dropped.
 */
import { eq } from 'drizzle-orm';
import { db, sql } from './db.ts';
import { leadNotes, leads, optionSets, users } from '../src/db/schema.ts';
import { normalizeIgHandle } from '../src/lib/calendly.ts';

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

async function loadRecords(fromFile: string | null): Promise<AirtableRecord[]> {
  if (fromFile) {
    const { readFile } = await import('node:fs/promises');
    const parsed = JSON.parse(await readFile(fromFile, 'utf8'));
    return parsed.records as AirtableRecord[];
  }
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error('AIRTABLE_PAT is not set (or pass --from-file)');
  return fetchFromAirtable(pat);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIdx = args.indexOf('--from-file');
  const fromFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  const records = await loadRecords(fromFile);
  console.log(`Loaded ${records.length} Airtable records${fromFile ? ` from ${fromFile}` : ''}`);

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

  const stats = { inserted: 0, updated: 0, notes: 0, noSetter: 0, blankHandle: 0 };

  for (const rec of records) {
    const c = rec.cellValuesByFieldId;
    const rawHandle = str(c[F.igHandle]);
    if (!rawHandle) stats.blankHandle += 1;

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

    const values = {
      igHandle: rawHandle ?? '(no handle)',
      igHandleKey: normalizeIgHandle(rawHandle),
      setterId,
      leadSource: noteOption('lead_source', str(c[F.leadSource])),
      opener: noteOption('opener', str(c[F.opener])),
      conversationStage: noteOption('conversation_stage', str(c[F.conversationStage])),
      leadQuality: noteOption('lead_quality', str(c[F.leadQuality])),
      icp: noteOption('icp', str(c[F.icp])),
      sourceContent: str(c[F.sourceContent]),
      outboundDm: bool(c[F.outboundDm]),
      responded: bool(c[F.responded]),
      respondedAt: date(c[F.responseDate]),
      followUps: num(c[F.followUps]) ?? 0,
      lastContactAt: date(c[F.lastContact]),
      nextFollowUpAt: date(c[F.nextFollowUp]),
      callBooked: bool(c[F.callBooked]),
      // Airtable's "Call Booked Date" is read as the day the booking was made;
      // "Show Date" is the day the call actually happened, which is the closest
      // thing the old data has to a scheduled time. Going forward Calendly
      // fills both properly and neither is inferred.
      callBookedAt: date(c[F.callBookedDate]),
      callScheduledFor: date(c[F.showDate]),
      callCancelled: bool(c[F.callCancelled]),
      cancelReason: noteOption('cancel_reason', str(c[F.cancelReason])),
      showed: bool(c[F.showed]),
      qualified: bool(c[F.qualified]),
      closed: bool(c[F.closed]),
      closedDate: date(c[F.closedDate]),
      cashCollected: num(c[F.cashCollected])?.toFixed(2) ?? null,
      contractValue: num(c[F.contractValue])?.toFixed(2) ?? null,
      lostReason: noteOption('lost_reason', str(c[F.lostReason])),
      postCallNotes: str(c[F.postCallNotes]),
      leadCreatedAt: date(c[F.leadCreated]) ?? (rec.createdTime ? new Date(rec.createdTime) : new Date()),
      airtableRecordId: rec.id,
      legacy: Object.keys(legacy).length > 0 ? legacy : null,
      updatedAt: new Date(),
    };

    if (dryRun) {
      stats.inserted += 1;
      continue;
    }

    const existing = await db.query.leads.findFirst({
      where: eq(leads.airtableRecordId, rec.id),
      columns: { id: true },
    });

    let leadId: string;
    if (existing) {
      await db.update(leads).set(values).where(eq(leads.id, existing.id));
      leadId = existing.id;
      stats.updated += 1;
    } else {
      const [row] = await db.insert(leads).values(values).returning({ id: leads.id });
      leadId = row.id;
      stats.inserted += 1;
    }

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

  if (!dryRun) {
    let optionCount = 0;
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
    console.log(`✓ ${optionCount} dropdown options in actual use`);
  }

  console.log(
    `\n${dryRun ? '[dry run] ' : ''}` +
      `inserted ${stats.inserted}, updated ${stats.updated}, notes migrated ${stats.notes}`
  );
  if (stats.blankHandle > 0) console.log(`⚠  ${stats.blankHandle} rows had no IG handle`);
  if (stats.noSetter > 0) {
    console.log(`⚠  ${stats.noSetter} rows name a setter with no matching user row`);
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
