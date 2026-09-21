/**
 * Two rows for one person.
 *
 * The tracker holds 22 handles twice - a setter opened a second row rather than
 * finding the first - and each copy carries half the story: one has the
 * conversation, the other has the call that came out of it. Nothing here
 * guesses which is which. It finds the pairs, shows both, and lets somebody who
 * knows the conversation decide.
 *
 * Matching is on the normalized handle alone. Anything looser (name, email,
 * fuzzy handle) would put strangers in front of somebody with a Merge button
 * under them, and a wrong merge is not undoable.
 */
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import {
  calendlyWebhookEvents,
  leadEvents,
  leadMerges,
  leadNotDuplicates,
  leadNotes,
  leads,
  postCallReports,
  todos,
  users,
} from '../db/schema.ts';
import { planMerge, type LeadRow, type MergePlan } from './mergePlan.ts';

type Db = PostgresJsDatabase<typeof schema>;

export type DuplicateLead = LeadRow & {
  setterName: string | null;
  noteCount: number;
};

export type DuplicateGroup = {
  handleKey: string;
  leads: DuplicateLead[];
};

/** Pair ids in a fixed order, so one pair can only be dismissed once. */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Every handle held by more than one real lead. */
async function duplicatedHandleKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({ key: leads.igHandleKey })
    .from(leads)
    .where(and(isNotNull(leads.igHandleKey), ne(leads.igHandleKey, ''), eq(leads.isTest, false)))
    .groupBy(leads.igHandleKey)
    .having(sql`COUNT(*) > 1`);
  return rows.map((r) => r.key).filter((k): k is string => k !== null);
}

/**
 * Pairs somebody has already said are two different people.
 *
 * A group survives dismissal as long as one pair in it is still unanswered, so
 * a third row landing on the same handle later gets asked about rather than
 * hiding behind an answer given about the other two.
 */
async function dismissedPairs(db: Db, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const rows = await db
    .select({ a: leadNotDuplicates.leadAId, b: leadNotDuplicates.leadBId })
    .from(leadNotDuplicates)
    .where(
      and(inArray(leadNotDuplicates.leadAId, leadIds), inArray(leadNotDuplicates.leadBId, leadIds))
    );
  return new Set(rows.map((r) => `${r.a}:${r.b}`));
}

/** True while any two leads in the group have not been ruled out as a pair. */
function groupIsOpen(group: DuplicateGroup, dismissed: Set<string>): boolean {
  for (let i = 0; i < group.leads.length; i++) {
    for (let j = i + 1; j < group.leads.length; j++) {
      const [a, b] = pairKey(group.leads[i].id, group.leads[j].id);
      if (!dismissed.has(`${a}:${b}`)) return true;
    }
  }
  return false;
}

export async function getDuplicateGroups(db: Db): Promise<DuplicateGroup[]> {
  const keys = await duplicatedHandleKeys(db);
  if (keys.length === 0) return [];

  const rows = await db
    .select({
      lead: leads,
      setterName: users.name,
      noteCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${leadNotes} WHERE ${leadNotes.leadId} = ${leads.id}
      )`,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.setterId))
    .where(and(inArray(leads.igHandleKey, keys), eq(leads.isTest, false)))
    .orderBy(leads.igHandleKey, leads.leadCreatedAt);

  const byKey = new Map<string, DuplicateLead[]>();
  for (const row of rows) {
    const key = row.lead.igHandleKey!;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ ...row.lead, setterName: row.setterName, noteCount: row.noteCount });
  }

  const groups = [...byKey.entries()].map(([handleKey, ls]) => ({ handleKey, leads: ls }));
  const dismissed = await dismissedPairs(
    db,
    groups.flatMap((g) => g.leads.map((l) => l.id))
  );
  return groups
    .filter((g) => groupIsOpen(g, dismissed))
    .sort((a, b) => a.handleKey.localeCompare(b.handleKey));
}

/**
 * For the badge. Same rules as the list, but it only reads ids - this runs on
 * every visit to the lead tracker, where the list itself runs once somebody
 * goes looking.
 */
export async function countDuplicateGroups(db: Db): Promise<number> {
  const keys = await duplicatedHandleKeys(db);
  if (keys.length === 0) return 0;

  const rows = await db
    .select({ id: leads.id, key: leads.igHandleKey })
    .from(leads)
    .where(and(inArray(leads.igHandleKey, keys), eq(leads.isTest, false)));

  const byKey = new Map<string, DuplicateLead[]>();
  for (const r of rows) {
    const key = r.key!;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ id: r.id } as DuplicateLead);
  }
  const dismissed = await dismissedPairs(
    db,
    rows.map((r) => r.id)
  );
  return [...byKey.entries()].filter(([handleKey, ls]) =>
    groupIsOpen({ handleKey, leads: ls }, dismissed)
  ).length;
}

/** What keeping `keepId` over `dropId` would pull across, for the screen. */
export async function previewMerge(
  db: Db,
  keepId: string,
  dropId: string
): Promise<MergePlan | null> {
  const [keep, drop] = await Promise.all([
    db.query.leads.findFirst({ where: eq(leads.id, keepId) }),
    db.query.leads.findFirst({ where: eq(leads.id, dropId) }),
  ]);
  if (!keep || !drop) return null;
  return planMerge(keep, drop);
}

export type MergeResult = { ok: true; brings: string[] } | { ok: false; error: string };

/**
 * Folds one lead into another and removes it.
 *
 * Order matters. Everything pointing at the row being removed is moved first,
 * because two of those references would otherwise take it with them:
 * lead_notes and lead_events cascade, and calendly_webhook_events doesn't
 * cascade at all, so a delete would simply fail on a lead Calendly had ever
 * booked. The tombstone is written before the delete for the same reason the
 * table exists - the record id has to survive the row.
 */
export async function mergeLeads(
  db: Db,
  { keepId, dropId, actorId = null }: { keepId: string; dropId: string; actorId?: string | null }
): Promise<MergeResult> {
  if (keepId === dropId) return { ok: false, error: 'That is the same lead twice.' };

  const [keep, drop] = await Promise.all([
    db.query.leads.findFirst({ where: eq(leads.id, keepId) }),
    db.query.leads.findFirst({ where: eq(leads.id, dropId) }),
  ]);
  if (!keep) return { ok: false, error: 'The lead to keep no longer exists.' };
  if (!drop) return { ok: false, error: 'The other lead has already gone.' };

  const { changes, brings } = planMerge(keep, drop);

  // The unique columns have to come off the row being removed before they can
  // land on the one being kept, or the update collides with a row that is
  // about to stop existing.
  if (changes.airtableRecordId || changes.postCallRecordId) {
    await db
      .update(leads)
      .set({
        ...(changes.airtableRecordId ? { airtableRecordId: null } : {}),
        ...(changes.postCallRecordId ? { postCallRecordId: null } : {}),
      })
      .where(eq(leads.id, dropId));
  }

  if (Object.keys(changes).length > 0) {
    await db
      .update(leads)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(leads.id, keepId));
  }

  await db.update(leadNotes).set({ leadId: keepId }).where(eq(leadNotes.leadId, dropId));
  await db.update(leadEvents).set({ leadId: keepId }).where(eq(leadEvents.leadId, dropId));
  await db.update(todos).set({ leadId: keepId }).where(eq(todos.leadId, dropId));
  await db
    .update(calendlyWebhookEvents)
    .set({ matchedLeadId: keepId })
    .where(eq(calendlyWebhookEvents.matchedLeadId, dropId));
  await db
    .update(postCallReports)
    .set({ leadId: keepId })
    .where(eq(postCallReports.leadId, dropId));

  // Anything said about the removed row now belongs to the survivor, so the
  // pair can't come back as its own question.
  await db
    .delete(leadNotDuplicates)
    .where(or(eq(leadNotDuplicates.leadAId, dropId), eq(leadNotDuplicates.leadBId, dropId)));

  await db.insert(leadMerges).values({
    mergedLeadId: dropId,
    mergedAirtableRecordId: drop.airtableRecordId,
    mergedIgHandle: drop.igHandle,
    keptLeadId: keepId,
    mergedById: actorId,
  });

  await db.insert(leadEvents).values({
    leadId: keepId,
    actorId,
    type: 'merged',
    fromValue: drop.igHandle,
    toValue: keep.igHandle,
    meta: { mergedLeadId: dropId, mergedAirtableRecordId: drop.airtableRecordId, brings },
  });

  await db.delete(leads).where(eq(leads.id, dropId));
  return { ok: true, brings };
}

export async function dismissPair(
  db: Db,
  { aId, bId, actorId = null }: { aId: string; bId: string; actorId?: string | null }
): Promise<void> {
  const [leadAId, leadBId] = pairKey(aId, bId);
  await db
    .insert(leadNotDuplicates)
    .values({ leadAId, leadBId, dismissedById: actorId })
    .onConflictDoNothing();
}

/** Lets the Airtable import follow a record id to whichever lead survived. */
export async function leadIdForMergedRecord(
  db: Db,
  airtableRecordId: string
): Promise<string | null> {
  const row = await db.query.leadMerges.findFirst({
    where: eq(leadMerges.mergedAirtableRecordId, airtableRecordId),
    columns: { keptLeadId: true },
  });
  return row?.keptLeadId ?? null;
}

export type RecentMerge = {
  id: string;
  mergedIgHandle: string | null;
  keptLeadId: string;
  keptIgHandle: string | null;
  byName: string | null;
  createdAt: Date;
};

/**
 * What has already been folded together.
 *
 * A merge removes the card that was asked about, so the only sign it worked is
 * that the thing you were looking at is gone - which is also what a bug looks
 * like. This is the receipt: what went where, and who did it.
 */
export async function recentMerges(db: Db, limit = 8): Promise<RecentMerge[]> {
  return db
    .select({
      id: leadMerges.id,
      mergedIgHandle: leadMerges.mergedIgHandle,
      keptLeadId: leadMerges.keptLeadId,
      keptIgHandle: leads.igHandle,
      byName: users.name,
      createdAt: leadMerges.createdAt,
    })
    .from(leadMerges)
    .leftJoin(leads, eq(leads.id, leadMerges.keptLeadId))
    .leftJoin(users, eq(users.id, leadMerges.mergedById))
    .orderBy(desc(leadMerges.createdAt))
    .limit(limit);
}
