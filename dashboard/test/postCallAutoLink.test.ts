import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leadEvents, leads, postCallReports } from '../src/db/schema.ts';
import { autoLinkPending } from '../src/lib/postCall.ts';

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
  await db.delete(leadEvents);
  await db.delete(postCallReports);
  await db.delete(leads);
});

/** A lead with a booked call at the given moment. */
async function bookedLead(over: { handle: string; name?: string | null; at: string }) {
  const [row] = await db
    .insert(leads)
    .values({
      igHandle: over.handle,
      igHandleKey: over.handle,
      name: over.name ?? null,
      callBooked: true,
      callCancelled: false,
      callScheduledFor: new Date(over.at),
      isTest: false,
    })
    .returning({ id: leads.id });
  return row.id;
}

/**
 * `day` is the calendar day the Airtable form recorded, as a YYYY-MM-DD string.
 *
 * Stored at noon UTC because that is what mapRecord produces: Airtable's date
 * field has no time, and noon is the one hour that lands on the same calendar
 * day whichever way a timezone shifts it. Midnight would read as the previous
 * evening in ET and put every report on the day before.
 */
async function report(over: { rec: string; leadName: string; day: string; outcome?: string }) {
  const [row] = await db
    .insert(postCallReports)
    .values({
      airtableRecordId: over.rec,
      leadName: over.leadName,
      callDate: new Date(`${over.day}T12:00:00Z`),
      outcome: over.outcome ?? 'closed',
      cashCollected: '5000.00',
      contractValue: '10000.00',
      status: 'pending',
      fingerprint: over.rec,
    })
    .returning({ id: postCallReports.id });
  return row.id;
}

test('one call that day by somebody of that name is placed without asking', { skip }, async () => {
  const leadId = await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  const repId = await report({ rec: 'rec1', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 1);

  const rep = await db.query.postCallReports.findFirst({ where: eq(postCallReports.id, repId) });
  assert.equal(rep?.status, 'linked');
  assert.equal(rep?.leadId, leadId);

  // The point of linking is the outcome landing on the lead.
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  assert.equal(lead?.closed, true);
  assert.equal(lead?.cashCollected, '5000.00');
});

test('an 8pm call is matched to its own evening, not to tomorrow', { skip }, async () => {
  // 8pm ET on the 22nd is midnight UTC on the 23rd. Comparing UTC dates would
  // put this call on the wrong day and leave every evening call unplaced.
  const leadId = await bookedLead({ handle: 'marcus.j', name: 'Marcus Jones', at: '2026-09-23T00:00:00Z' });
  await report({ rec: 'rec2', leadName: 'Marcus', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 1);
  const rep = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'rec2'),
  });
  assert.equal(rep?.leadId, leadId);
});

test('two people of that name that day are left for a person', { skip }, async () => {
  await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await bookedLead({ handle: 'gav.smith', name: 'Gavin Smith', at: '2026-09-22T19:00:00Z' });
  await report({ rec: 'rec3', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 0);
  const rep = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'rec3'),
  });
  assert.equal(rep?.status, 'pending');
});

test('a call on a different day is not the one being reported on', { skip }, async () => {
  await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-21T16:00:00Z' });
  await report({ rec: 'rec4', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 0);
});

test('a cancelled booking is not a call anybody reported on', { skip }, async () => {
  const id = await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await db.update(leads).set({ callCancelled: true }).where(eq(leads.id, id));
  await report({ rec: 'rec5', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 0);
});

test('a test booking never takes a real report', { skip }, async () => {
  const id = await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await db.update(leads).set({ isTest: true }).where(eq(leads.id, id));
  await report({ rec: 'rec6', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 0);
});

test('a lead already carrying a report does not take a second', { skip }, async () => {
  const leadId = await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await db.insert(postCallReports).values({
    airtableRecordId: 'recOld', leadName: 'Gavin', callDate: new Date('2026-09-22T12:00:00Z'),
    status: 'linked', leadId, fingerprint: 'recOld',
  });
  await report({ rec: 'rec7', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 0);
});

test('what the app placed is written down, so it can be seen and undone', { skip }, async () => {
  const leadId = await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await report({ rec: 'rec8', leadName: 'Gavin', day: '2026-09-22' });
  await autoLinkPending(db);

  const events = await db.query.leadEvents.findMany({ where: eq(leadEvents.leadId, leadId) });
  const auto = events.find((e) => e.type === 'post_call_auto_linked');
  assert.ok(auto, 'a close nobody typed should say where it came from');
  assert.equal(auto?.actorId, null, 'no person did this');
});

test('running it twice places nothing a second time', { skip }, async () => {
  await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await report({ rec: 'rec9', leadName: 'Gavin', day: '2026-09-22' });

  assert.equal(await autoLinkPending(db), 1);
  assert.equal(await autoLinkPending(db), 0, 'the second run has nothing left to do');
});

test('a report with no call date is never placed', { skip }, async () => {
  await bookedLead({ handle: 'gavin.r', name: 'Gavin Roberts', at: '2026-09-22T16:00:00Z' });
  await db.insert(postCallReports).values({
    airtableRecordId: 'rec10', leadName: 'Gavin', callDate: null, status: 'pending', fingerprint: 'rec10',
  });

  assert.equal(await autoLinkPending(db), 0);
});
