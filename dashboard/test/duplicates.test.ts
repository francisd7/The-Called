import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import {
  calendlyWebhookEvents,
  leadEvents,
  leadMerges,
  leadNotes,
  leads,
  postCallReports,
  users,
} from '../src/db/schema.ts';
import { planMerge, type LeadRow } from '../src/lib/mergePlan.ts';
import {
  countDuplicateGroups,
  dismissPair,
  getDuplicateGroups,
  leadIdForMergedRecord,
  mergeLeads,
} from '../src/lib/duplicates.ts';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

before(async () => {
  if (!url) return;
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run destructive tests against ${host}.`);
  }
  sql = postgres(url, { max: 2 });
  db = drizzle(sql, { schema });
});

after(async () => {
  if (sql) await sql.end();
});

beforeEach(async () => {
  if (!url) return;
  await db.delete(leadMerges);
  await db.delete(calendlyWebhookEvents);
  await db.delete(postCallReports);
  await db.delete(leadNotes);
  await db.delete(leads);
});

/** A lead with every column at its database default, for the pure tests. */
function blank(over: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'a', igHandle: 'x', igHandleKey: 'x', name: null, email: null, phone: null,
    setterId: null, leadSource: null, opener: null, conversationStage: null,
    leadQuality: null, icp: null, outboundDm: false, responded: false, respondedAt: null,
    followUps: 0, lastContactAt: null, nextFollowUpAt: null, offerId: null,
    callBooked: false, callBookedAt: null, callScheduledFor: null, closerId: null,
    closerName: null, calendlyEventUri: null, calendlyInviteeUri: null, calendlyAnswers: null,
    calendlyCancelUrl: null, calendlyRescheduleUrl: null, callCancelled: false,
    callCancelledAt: null, cancelReason: null, showed: null, confirmed: false,
    confirmedAt: null, confirmedById: null, confirmationMethod: null, triaged: false,
    triagedAt: null, triagedById: null, triageNotes: null, sourceContent: null,
    callOutcome: null, tier: null, paymentMethod: null, fathomUrl: null,
    outcomeLoggedAt: null, outcomeLoggedById: null, qualified: null, closed: null,
    closedDate: null, cashCollected: null, contractValue: null, lostReason: null,
    postCallNotes: null, leadCreatedAt: new Date('2026-07-01T00:00:00Z'),
    lastOutreachAt: null, isActiveConvo: false, isTest: false, airtableRecordId: null,
    postCallRecordId: null, needsHandle: false, legacy: null,
    createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  } as LeadRow;
}

// --- the rules, without a database ----------------------------------------

test('the row you keep wins every disagreement', () => {
  const { changes } = planMerge(
    blank({ conversationStage: 'mid_rapport', setterId: 'loui', leadQuality: 'a' }),
    blank({ conversationStage: 'outreached', setterId: 'alexis', leadQuality: 'c' })
  );
  assert.equal(changes.conversationStage, undefined);
  assert.equal(changes.setterId, undefined);
  assert.equal(changes.leadQuality, undefined);
});

test('the other row fills in what the keeper has not got', () => {
  const { changes, brings } = planMerge(
    blank({ setterId: null, email: null }),
    blank({ setterId: 'loui', email: 'them@example.com' })
  );
  assert.equal(changes.setterId, 'loui');
  assert.equal(changes.email, 'them@example.com');
  assert.ok(brings.includes('the setter it belongs to'));
});

test('a close on the other row is never left behind', () => {
  // The keeper reads closed: false because nobody ticked an Airtable box, not
  // because anybody decided the deal was lost.
  const { changes, brings } = planMerge(
    blank({ closed: false, cashCollected: null }),
    blank({ closed: true, cashCollected: '1500.00', closedDate: new Date('2026-08-10T00:00:00Z') })
  );
  assert.equal(changes.closed, true);
  assert.equal(changes.cashCollected, '1500.00');
  assert.ok(brings.includes('the close'));
});

test('a booking on the other row is never left behind', () => {
  const when = new Date('2026-09-18T15:00:00Z');
  const { changes } = planMerge(
    blank({ callBooked: false }),
    blank({ callBooked: true, callScheduledFor: when, calendlyEventUri: 'https://cal/x' })
  );
  assert.equal(changes.callBooked, true);
  assert.equal(changes.callScheduledFor, when);
  assert.equal(changes.calendlyEventUri, 'https://cal/x');
});

test('the stage follows the call rather than the row it came off', () => {
  const booked = planMerge(
    blank({ conversationStage: 'mid_rapport' }),
    blank({ callBooked: true })
  );
  assert.equal(booked.changes.conversationStage, 'call_booked');

  const won = planMerge(blank({ conversationStage: 'mid_rapport' }), blank({ closed: true }));
  assert.equal(won.changes.conversationStage, 'closed', 'a closed lead reads as closed');

  // Already closed, so a booking underneath it changes nothing.
  const stays = planMerge(blank({ conversationStage: 'closed', closed: true }), blank({ callBooked: true }));
  assert.equal(stays.changes.conversationStage, undefined);
});

test('the conversation started when the earlier of the two started', () => {
  const early = new Date('2026-06-02T00:00:00Z');
  const { changes } = planMerge(
    blank({ leadCreatedAt: new Date('2026-08-20T00:00:00Z') }),
    blank({ leadCreatedAt: early })
  );
  assert.equal(changes.leadCreatedAt, early);
});

test('activity and effort take the larger of the two', () => {
  const late = new Date('2026-09-15T00:00:00Z');
  const { changes } = planMerge(
    blank({ followUps: 2, lastContactAt: new Date('2026-08-01T00:00:00Z') }),
    blank({ followUps: 5, lastContactAt: late })
  );
  assert.equal(changes.followUps, 5);
  assert.equal(changes.lastContactAt, late);
});

test('a made-up handle gives way to a real one', () => {
  const { changes } = planMerge(
    blank({ needsHandle: true, igHandle: 'Gavin (no handle)' }),
    blank({ needsHandle: false, igHandle: '@gavin.b' })
  );
  assert.equal(changes.igHandle, '@gavin.b');
  assert.equal(changes.needsHandle, false);
});

// --- the merge itself ------------------------------------------------------

async function twoRows() {
  const [a] = await db
    .insert(leads)
    .values({
      igHandle: '@twice',
      igHandleKey: 'twice',
      conversationStage: 'mid_rapport',
      airtableRecordId: 'recA',
      leadCreatedAt: new Date('2026-06-10T00:00:00Z'),
    })
    .returning();
  const [b] = await db
    .insert(leads)
    .values({
      igHandle: 'twice',
      igHandleKey: 'twice',
      airtableRecordId: 'recB',
      callBooked: true,
      callScheduledFor: new Date('2026-08-14T15:00:00Z'),
      closed: true,
      cashCollected: '1000.00',
      leadCreatedAt: new Date('2026-08-01T00:00:00Z'),
    })
    .returning();
  return { a, b };
}

test('merging leaves one row holding both halves of the story', { skip }, async () => {
  const { a, b } = await twoRows();
  const res = await mergeLeads(db, { keepId: a.id, dropId: b.id });
  assert.equal(res.ok, true);

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 1);

  const kept = await db.query.leads.findFirst({ where: eq(leads.id, a.id) });
  assert.equal(kept?.callBooked, true, 'the booking was left on the row that was removed');
  assert.equal(kept?.closed, true);
  assert.equal(kept?.cashCollected, '1000.00');
  assert.equal(kept?.conversationStage, 'closed');
  assert.equal(
    kept?.leadCreatedAt?.toISOString(),
    '2026-06-10T00:00:00.000Z',
    'the conversation started in June, not August'
  );
});

test('notes and history follow the person, not the row', { skip }, async () => {
  const { a, b } = await twoRows();
  await db.insert(leadNotes).values({ leadId: b.id, authorId: null, body: 'Said yes on the call.' });
  await db.insert(leadEvents).values({ leadId: b.id, type: 'booked' });

  await mergeLeads(db, { keepId: a.id, dropId: b.id });

  const notes = await db.select().from(leadNotes).where(eq(leadNotes.leadId, a.id));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, 'Said yes on the call.');
  const events = await db.select().from(leadEvents).where(eq(leadEvents.leadId, a.id));
  assert.ok(events.some((e) => e.type === 'booked'), 'the booking event was lost');
  assert.ok(events.some((e) => e.type === 'merged'), 'nothing recorded that a merge happened');
});

test('a lead Calendly has booked can still be merged away', { skip }, async () => {
  // calendly_webhook_events.matched_lead_id has no ON DELETE, so without
  // re-pointing it first the delete fails outright on exactly the leads most
  // worth merging.
  const { a, b } = await twoRows();
  await db.insert(calendlyWebhookEvents).values({
    eventType: 'invitee.created',
    payload: {},
    matchedLeadId: b.id,
  });

  const res = await mergeLeads(db, { keepId: a.id, dropId: b.id });
  assert.equal(res.ok, true);
  const [ev] = await db.select().from(calendlyWebhookEvents);
  assert.equal(ev.matchedLeadId, a.id);
});

test('a post-call report follows the lead it was linked to', { skip }, async () => {
  const { a, b } = await twoRows();
  await db.insert(postCallReports).values({
    airtableRecordId: 'recReport',
    status: 'linked',
    leadId: b.id,
    leadName: 'Gavin',
  });

  await mergeLeads(db, { keepId: a.id, dropId: b.id });
  const [report] = await db.select().from(postCallReports);
  assert.equal(report.leadId, a.id);
});

test('the removed row leaves its Airtable id behind', { skip }, async () => {
  const { a, b } = await twoRows();
  await mergeLeads(db, { keepId: a.id, dropId: b.id });

  // The keeper had recA already, so recB can't move onto it - which is exactly
  // why it has to be remembered somewhere.
  const kept = await db.query.leads.findFirst({ where: eq(leads.id, a.id) });
  assert.equal(kept?.airtableRecordId, 'recA');
  assert.equal(await leadIdForMergedRecord(db, 'recB'), a.id);
});

test('an Airtable id moves across when the keeper has none', { skip }, async () => {
  const [a] = await db
    .insert(leads)
    .values({ igHandle: 'x', igHandleKey: 'x' })
    .returning();
  const [b] = await db
    .insert(leads)
    .values({ igHandle: 'x', igHandleKey: 'x', airtableRecordId: 'recOnly' })
    .returning();

  await mergeLeads(db, { keepId: a.id, dropId: b.id });
  const kept = await db.query.leads.findFirst({ where: eq(leads.id, a.id) });
  assert.equal(kept?.airtableRecordId, 'recOnly');
});

test('a lead cannot be merged into itself', { skip }, async () => {
  const { a } = await twoRows();
  const res = await mergeLeads(db, { keepId: a.id, dropId: a.id });
  assert.equal(res.ok, false);
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 2, 'a no-op merge deleted something');
});

// --- which pairs get asked about -------------------------------------------

test('only handles held twice are offered', { skip }, async () => {
  await db.insert(leads).values({ igHandle: 'alone', igHandleKey: 'alone' });
  await twoRows();

  const groups = await getDuplicateGroups(db);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].handleKey, 'twice');
  assert.equal(groups[0].leads.length, 2);
  assert.equal(await countDuplicateGroups(db), 1);
});

test('a test booking is never offered as somebody’s duplicate', { skip }, async () => {
  await db.insert(leads).values({ igHandle: 'rehearsal', igHandleKey: 'rehearsal', isTest: true });
  await db.insert(leads).values({ igHandle: 'rehearsal', igHandleKey: 'rehearsal', isTest: true });
  assert.equal(await countDuplicateGroups(db), 0);
});

test('two different people with one handle stay asked about only once', { skip }, async () => {
  const { a, b } = await twoRows();
  await dismissPair(db, { aId: a.id, bId: b.id });
  assert.equal(await countDuplicateGroups(db), 0);

  // Dismissing is per pair, so it survives being asked the other way round.
  await dismissPair(db, { aId: b.id, bId: a.id });
  assert.equal(await countDuplicateGroups(db), 0);
});

test('a third row on a settled handle gets asked about', { skip }, async () => {
  const { a, b } = await twoRows();
  await dismissPair(db, { aId: a.id, bId: b.id });
  assert.equal(await countDuplicateGroups(db), 0);

  await db.insert(leads).values({ igHandle: 'twice', igHandleKey: 'twice' });
  assert.equal(
    await countDuplicateGroups(db),
    1,
    'an answer about two rows was taken as an answer about three'
  );
});

// --- and it has to survive the next import ---------------------------------

test('a merge is not undone by the next Airtable import', { skip }, async () => {
  // The whole reason lead_merges exists. Both rows came from the tracker, so
  // the tracker still holds both record ids and will offer them again tomorrow.
  const { a, b } = await twoRows();
  await mergeLeads(db, { keepId: a.id, dropId: b.id });

  const { importAirtableLeads } = await import('../src/lib/airtableImport.ts');
  const { writeFile } = await import('node:fs/promises');
  const path = '/tmp/import-merge-case.json';
  await writeFile(
    path,
    JSON.stringify({
      records: [
        { id: 'recA', createdTime: '2026-06-10T00:00:00Z', cellValuesByFieldId: { fldHIn51ACE4y793J: '@twice' } },
        { id: 'recB', createdTime: '2026-08-01T00:00:00Z', cellValuesByFieldId: { fldHIn51ACE4y793J: 'twice' } },
      ],
    })
  );

  const stats = await importAirtableLeads(db, { fromFile: path });
  assert.equal(stats.followedMerge, 1, 'the merged-away row was not recognised');
  assert.equal(stats.inserted, 0, 'the import rebuilt the duplicate somebody just resolved');

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 1);
  const kept = await db.query.leads.findFirst({ where: eq(leads.id, a.id) });
  assert.equal(kept?.airtableRecordId, 'recA', 'the surviving lead lost its own record id');
});
