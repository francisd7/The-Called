import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count, eq, isNotNull, isNull } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leadNotes, leads, optionSets, postCallReports, users } from '../src/db/schema.ts';
import { importAirtableLeads } from '../src/lib/airtableImport.ts';
import type { PostCallRecord } from '../src/lib/postCall.ts';

// Runs against a real Postgres when one is configured. Skipped otherwise so
// the suite still passes on a machine without a database.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

before(async () => {
  if (!url) return;
  // These tests delete every lead. Pointing TEST_DATABASE_URL at a real
  // database would empty it, so refuse anything that isn't obviously local.
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      `Refusing to run destructive tests against ${host}. TEST_DATABASE_URL must be a local database.`
    );
  }
  sql = postgres(url, { max: 2 });
  db = drizzle(sql, { schema });
  await db.delete(postCallReports);
  await db.delete(leadNotes);
  await db.delete(leads);
});

after(async () => {
  if (sql) await sql.end();
});

const SNAPSHOT = '/tmp/import-fixture.json';

test('imports every record and nothing more', { skip }, async () => {
  const stats = await importAirtableLeads(db, { fromFile: SNAPSHOT });
  assert.equal(stats.loaded, 541);
  assert.equal(stats.inserted, 541);
  assert.equal(stats.updated, 0);

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 541);
});

test('a second run updates rather than duplicating', { skip }, async () => {
  // This is what makes it safe to re-run right before cutover to pick up
  // whatever changed in Airtable in the meantime.
  const stats = await importAirtableLeads(db, { fromFile: SNAPSHOT });
  assert.equal(stats.inserted, 0);
  assert.equal(stats.updated, 541);

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 541);
});

test('a re-run does not duplicate the migrated notes either', { skip }, async () => {
  const [{ n }] = await db.select({ n: count() }).from(leadNotes);
  assert.equal(n, 264);
});

test('handles are normalized for matching but preserved for display', { skip }, async () => {
  const row = await db.query.leads.findFirst({ where: eq(leads.igHandle, 'Modia_fit') });
  assert.ok(row, 'expected the original casing to be kept');
  assert.equal(row.igHandleKey, 'modia_fit');
});

test('unmapped Airtable fields are kept rather than dropped', { skip }, async () => {
  const [{ n }] = await db
    .select({ n: count() })
    .from(leads)
    .where(isNotNull(leads.legacy));
  // Analytics Stage duplicated Conversation Stage so it got no column, but it
  // still has to survive the migration.
  assert.ok(n > 400, `expected most rows to carry legacy data, got ${n}`);
});

test('dropdowns come from values in use, not the full Airtable lists', { skip }, async () => {
  const stages = await db.select().from(optionSets).where(eq(optionSets.kind, 'conversation_stage'));
  // Baseline seed plus whatever the data actually used, and well short of the
  // ~50 dead Opener options Airtable carries.
  assert.ok(stages.length > 10, `expected real stages, got ${stages.length}`);
  const openers = await db.select().from(optionSets).where(eq(optionSets.kind, 'opener'));
  assert.ok(openers.length > 0 && openers.length < 50, `got ${openers.length} openers`);
});

test('a dry run reports without writing', { skip }, async () => {
  await db.delete(postCallReports);
  await db.delete(leadNotes);
  await db.delete(leads);
  const stats = await importAirtableLeads(db, { fromFile: SNAPSHOT, dryRun: true });
  assert.equal(stats.dryRun, true);
  assert.equal(stats.loaded, 541);

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 0, 'dry run must not write');
});

test('setters named in Airtable resolve to real user rows', { skip }, async () => {
  await importAirtableLeads(db, { fromFile: SNAPSHOT });
  const loui = await db.query.users.findFirst({ where: eq(users.name, 'Loui') });
  assert.ok(loui);
  const [{ n }] = await db.select({ n: count() }).from(leads).where(eq(leads.setterId, loui.id));
  assert.ok(n > 0, 'expected leads attributed to Loui');
});

test('a re-import never unassigns a lead someone has taken', { skip }, async () => {
  // Most Airtable rows have no setter. Writing that null through on an update
  // wiped every assignment made in the dashboard - including the backfill that
  // gave the whole unowned backlog an owner.
  await importAirtableLeads(db, { fromFile: SNAPSHOT });

  const owner = await db.query.users.findFirst({ where: eq(users.name, 'Francis') });
  assert.ok(owner, 'expected a Francis to assign to');

  // Take an imported lead that Airtable has no setter for.
  const orphan = await db.query.leads.findFirst({ where: isNull(leads.setterId) });
  assert.ok(orphan, 'expected at least one lead with no setter from Airtable');

  await db.update(leads).set({ setterId: owner.id }).where(eq(leads.id, orphan.id));
  await importAirtableLeads(db, { fromFile: SNAPSHOT });

  const after = await db.query.leads.findFirst({ where: eq(leads.id, orphan.id) });
  assert.equal(after?.setterId, owner.id, 'the re-import unassigned a claimed lead');
});

test('a re-import never resets the manual active flag', { skip }, async () => {
  const lead = await db.query.leads.findFirst({ where: eq(leads.isActiveConvo, false) });
  assert.ok(lead);
  await db.update(leads).set({ isActiveConvo: true }).where(eq(leads.id, lead.id));

  await importAirtableLeads(db, { fromFile: SNAPSHOT });

  const after = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) });
  assert.equal(after?.isActiveConvo, true, 'the re-import cleared a manual flag');
});

const POST_CALL: PostCallRecord[] = [
  {
    id: 'recTESTclose',
    fields: {
      fldoKwFzHYAUpXPre: 'Gavin Test',
      fldNz6hFtSdkT5sFU: '2026-09-10',
      flducCunxzZ08ZJxD: { name: 'Nigel' },
      fldN5bRlNhGA58J33: { name: 'Loui' },
      fld79p1lPISYwNRpi: { name: 'Closed' },
      fld8vpPRdacNoF4E5: { name: 'Momentum' },
      fldtETT2XDthDXhcb: { name: 'Splitit' },
      fldDfGJABBrqos4sQ: 5000,
      fldWQ2MDlZDH4HLRL: 10000,
      fldBvetzSMDYJRAJm: 'Split over five months.',
      fld6E6FpFUUnEZBi9: 'https://fathom.video/share/abc',
    },
  },
  {
    id: 'recTESTnoclose',
    fields: {
      fldoKwFzHYAUpXPre: 'Nobody Closed',
      fldNz6hFtSdkT5sFU: '2026-09-11',
      fld79p1lPISYwNRpi: { name: 'No Close' },
      fld8vpPRdacNoF4E5: { name: 'No Close' },
      fldtETT2XDthDXhcb: { name: 'No Close' },
      fldDfGJABBrqos4sQ: 0,
      fldWQ2MDlZDH4HLRL: 0,
      fld6E6FpFUUnEZBi9: 'Will add once home ',
    },
  },
];

test('post-call reports queue up rather than writing themselves onto leads', { skip }, async () => {
  const { syncPostCallReports } = await import('../src/lib/postCall.ts');

  const before = await db.select({ n: count() }).from(leads);
  const stats = await syncPostCallReports(db, { records: POST_CALL });
  const afterCount = await db.select({ n: count() }).from(leads);

  assert.equal(stats.added, 2);
  assert.equal(
    afterCount[0].n,
    before[0].n,
    'a report created a lead on its own - nothing should touch leads until somebody links it'
  );

  const won = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTclose'),
  });
  assert.ok(won);
  assert.equal(won.status, 'pending');
  assert.equal(won.outcome, 'closed');
  assert.equal(won.contractValue, '10000.00');
  assert.equal(won.tier, 'Momentum');
  assert.equal(won.fathomUrl, 'https://fathom.video/share/abc');

  const lost = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTnoclose'),
  });
  assert.ok(lost);
  // "No Close" is Airtable's placeholder, not a real tier or payment method.
  assert.equal(lost.tier, null);
  assert.equal(lost.paymentMethod, null);
  // The Fathom column sometimes holds a note rather than a link.
  assert.equal(lost.fathomUrl, null);

  // Re-syncing changes nothing.
  const again = await syncPostCallReports(db, { records: POST_CALL });
  assert.equal(again.added, 0);
  assert.equal(again.changed, 0);
});

test('linking a report records the outcome and the booking it implies', { skip }, async () => {
  const { applyToLead, syncPostCallReports } = await import('../src/lib/postCall.ts');
  await syncPostCallReports(db, { records: POST_CALL });

  const report = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTclose'),
  });
  assert.ok(report);

  // A lead nobody ever recorded a booking for - which is the whole reason
  // these reports exist.
  const [target] = await db
    .insert(leads)
    .values({ igHandle: 'link_me_test', igHandleKey: 'link_me_test' })
    .returning({ id: leads.id });

  await applyToLead(db, { report, leadId: target.id });

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, target.id) });
  assert.ok(lead);
  assert.equal(lead.closed, true);
  assert.equal(lead.showed, true);
  assert.equal(lead.cashCollected, '5000.00');
  assert.equal(lead.conversationStage, 'closed');
  assert.equal(lead.callBooked, true, 'a call happened, so the booking should be filled in');
  assert.ok(lead.callScheduledFor);

  // A lead flagged as booked but carrying no date - which the Airtable import
  // left plenty of - gets the date filled in too.
  const other = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTnoclose'),
  });
  assert.ok(other);
  const [dateless] = await db
    .insert(leads)
    .values({
      igHandle: 'dateless_test',
      igHandleKey: 'dateless_test',
      callBooked: true,
    })
    .returning({ id: leads.id });
  await applyToLead(db, { report: other, leadId: dateless.id });
  const filled = await db.query.leads.findFirst({ where: eq(leads.id, dateless.id) });
  assert.ok(filled?.callScheduledFor, 'a booked lead with no date should get the call date');
  await db.delete(leads).where(eq(leads.id, dateless.id));
  assert.equal(lead.postCallRecordId, 'recTESTclose');

  await db.delete(leads).where(eq(leads.id, target.id));
});

test('moving a report to another lead takes it off the first one', { skip }, async () => {
  const { applyToLead, syncPostCallReports } = await import('../src/lib/postCall.ts');
  await syncPostCallReports(db, { records: POST_CALL });

  const report = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTclose'),
  });
  assert.ok(report);

  const [wrong] = await db
    .insert(leads)
    .values({ igHandle: 'wrong_person', igHandleKey: 'wrong_person' })
    .returning({ id: leads.id });
  const [right] = await db
    .insert(leads)
    .values({ igHandle: 'right_person', igHandleKey: 'right_person' })
    .returning({ id: leads.id });

  await applyToLead(db, { report, leadId: wrong.id });
  // Only one lead may hold a report, so this has to release the first rather
  // than fail on the unique column.
  await applyToLead(db, { report, leadId: right.id });

  const a = await db.query.leads.findFirst({ where: eq(leads.id, wrong.id) });
  const b = await db.query.leads.findFirst({ where: eq(leads.id, right.id) });
  assert.equal(a?.postCallRecordId, null);
  assert.equal(b?.postCallRecordId, 'recTESTclose');

  await db.delete(leads).where(eq(leads.id, wrong.id));
  await db.delete(leads).where(eq(leads.id, right.id));
});

test('an edit in Airtable reaches a lead the report is already linked to', { skip }, async () => {
  const { applyToLead, syncPostCallReports } = await import('../src/lib/postCall.ts');
  await syncPostCallReports(db, { records: POST_CALL });

  const [target] = await db
    .insert(leads)
    .values({ igHandle: 'edit_me_test', igHandleKey: 'edit_me_test' })
    .returning({ id: leads.id });

  const report = await db.query.postCallReports.findFirst({
    where: eq(postCallReports.airtableRecordId, 'recTESTclose'),
  });
  assert.ok(report);
  await applyToLead(db, { report, leadId: target.id });
  await db
    .update(postCallReports)
    .set({ status: 'linked', leadId: target.id })
    .where(eq(postCallReports.id, report.id));

  const corrected = structuredClone(POST_CALL);
  corrected[0].fields.fldDfGJABBrqos4sQ = 7500;
  const stats = await syncPostCallReports(db, { records: corrected });

  assert.equal(stats.changed, 1);
  assert.equal(stats.reapplied, 1);

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, target.id) });
  assert.equal(lead?.cashCollected, '7500.00');

  await db.delete(leads).where(eq(leads.id, target.id));
});

// --- what the tracker may no longer overwrite ------------------------------
//
// Airtable stopped being the only source the day Calendly started booking the
// calls and the Post Call form started recording them. It holds no booking
// after 25 August and knows 31 of the 69 cancellations. An import that writes
// every column would roll all of that back - and only half way, because
// callOutcome and postCallRecordId have no Airtable field and would survive,
// leaving a lead linked to a report saying it closed while its own closed
// column read false.

const F_TEST = {
  igHandle: 'fldHIn51ACE4y793J',
  leadCreated: 'fldF0joEuTE5Odfhi',
  conversationStage: 'fldHblRu88jWT9q36',
  responded: 'fldOtUSwvRWYihtvp',
  callBooked: 'fldrjHfOXzIawwzXi',
  callBookedDate: 'fldQlbNh9tc1DdHgq',
  showDate: 'fldFoaJrt0uTyRS3X',
  closed: 'fldW7oLHrZLIDecLA',
  cashCollected: 'fldiOBSr2CqA8vuyQ',
} as const;

type Cells = Partial<Record<keyof typeof F_TEST, unknown>>;

/** Writes a throwaway Airtable snapshot and returns the path to import from. */
async function fixture(rows: Array<{ id: string } & Cells>): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  const path = `/tmp/import-case-${Math.random().toString(36).slice(2)}.json`;
  await writeFile(
    path,
    JSON.stringify({
      records: rows.map(({ id, ...cells }) => ({
        id,
        createdTime: '2026-09-01T00:00:00.000Z',
        cellValuesByFieldId: Object.fromEntries(
          Object.entries(cells).map(([k, v]) => [F_TEST[k as keyof typeof F_TEST], v])
        ),
      })),
    })
  );
  return path;
}

async function clearLeads() {
  await db.delete(postCallReports);
  await db.delete(leadNotes);
  await db.delete(leads);
}

test('a blank tracker row never clears a Calendly booking', { skip }, async () => {
  await clearLeads();
  const scheduled = new Date('2026-09-18T15:00:00.000Z');
  await db.insert(leads).values({
    igHandle: '@bookedbycalendly',
    igHandleKey: 'bookedbycalendly',
    airtableRecordId: 'recCAL',
    calendlyEventUri: 'https://api.calendly.com/scheduled_events/abc',
    callBooked: true,
    callBookedAt: new Date('2026-09-12T09:00:00.000Z'),
    callScheduledFor: scheduled,
  });

  // The setter never ticked Call Booked, because Calendly did it for them.
  const stats = await importAirtableLeads(db, {
    fromFile: await fixture([
      { id: 'recCAL', igHandle: '@bookedbycalendly', conversationStage: { name: 'Booked' } },
    ]),
  });

  assert.equal(stats.bookingsKept, 1);
  const lead = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recCAL') });
  assert.equal(lead?.callBooked, true, 'the import cleared a booking Calendly owns');
  assert.equal(lead?.callScheduledFor?.toISOString(), scheduled.toISOString());
});

test('a blank tracker row never clears a post-call outcome', { skip }, async () => {
  await clearLeads();
  await db.insert(leads).values({
    igHandle: '@closedoncall',
    igHandleKey: 'closedoncall',
    airtableRecordId: 'recOUT',
    postCallRecordId: 'recReport1',
    callOutcome: 'closed',
    closed: true,
    showed: true,
    cashCollected: '1200.00',
    outcomeLoggedAt: new Date('2026-09-03T18:00:00.000Z'),
  });

  const stats = await importAirtableLeads(db, {
    fromFile: await fixture([
      { id: 'recOUT', igHandle: '@closedoncall', conversationStage: { name: 'Mid Rapport' } },
    ]),
  });

  assert.equal(stats.outcomesKept, 1);
  const lead = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recOUT') });
  assert.equal(lead?.closed, true, 'the import cleared a close the post-call report recorded');
  assert.equal(lead?.cashCollected, '1200.00');
  // The half-written state this guards against: callOutcome has no Airtable
  // field, so it would have survived a wipe of the columns beside it.
  assert.equal(lead?.callOutcome, 'closed');
});

test('a booking the setter typed into the tracker still comes through', { skip }, async () => {
  await clearLeads();
  await db.insert(leads).values({
    igHandle: '@bookedindm',
    igHandleKey: 'bookedindm',
    airtableRecordId: 'recDM',
  });

  await importAirtableLeads(db, {
    fromFile: await fixture([
      {
        id: 'recDM',
        igHandle: '@bookedindm',
        callBooked: true,
        callBookedDate: '2026-09-15',
        showDate: '2026-09-17',
        closed: true,
        cashCollected: 2000,
      },
    ]),
  });

  const lead = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recDM') });
  assert.equal(lead?.callBooked, true, 'a call booked outside Calendly has to reach the dashboard');
  assert.equal(lead?.closed, true);
  assert.equal(lead?.cashCollected, '2000.00');
});

test('Calendly wins when the tracker disagrees about the same booking', { skip }, async () => {
  await clearLeads();
  const truth = new Date('2026-09-18T15:00:00.000Z');
  await db.insert(leads).values({
    igHandle: '@both',
    igHandleKey: 'both',
    airtableRecordId: 'recBOTH',
    calendlyEventUri: 'https://api.calendly.com/scheduled_events/xyz',
    callBooked: true,
    callScheduledFor: truth,
  });

  await importAirtableLeads(db, {
    fromFile: await fixture([
      { id: 'recBOTH', igHandle: '@both', callBooked: true, showDate: '2026-08-02' },
    ]),
  });

  const lead = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recBOTH') });
  assert.equal(
    lead?.callScheduledFor?.toISOString(),
    truth.toISOString(),
    'a hand-typed date overwrote the one Calendly knows to the minute'
  );
});

test('a new tracker row joins a lead Calendly already created', { skip }, async () => {
  await clearLeads();
  // The Calendly backfill creates leads for people the tracker never had. When
  // a setter finally types one in, the two have to become one row - otherwise
  // the booking sits on a copy nobody is looking at.
  await db.insert(leads).values({
    igHandle: 'latecomer',
    igHandleKey: 'latecomer',
    calendlyEventUri: 'https://api.calendly.com/scheduled_events/late',
    callBooked: true,
    callScheduledFor: new Date('2026-09-19T14:00:00.000Z'),
  });

  const stats = await importAirtableLeads(db, {
    fromFile: await fixture([
      { id: 'recLATE', igHandle: '@Latecomer', conversationStage: { name: 'Booked' } },
    ]),
  });

  assert.equal(stats.adopted, 1);
  assert.equal(stats.inserted, 0, 'the import made a second copy of somebody who was already here');

  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 1);
  const lead = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recLATE') });
  assert.equal(lead?.callBooked, true, 'joining the rows lost the booking');
});

test('two unclaimed leads with the same handle are never guessed between', { skip }, async () => {
  await clearLeads();
  for (let i = 0; i < 2; i++) {
    await db.insert(leads).values({ igHandle: `twin${i}`, igHandleKey: 'twins' });
  }

  const stats = await importAirtableLeads(db, {
    fromFile: await fixture([{ id: 'recTWIN', igHandle: 'twins' }]),
  });

  // Picking one would weld two real people together. A third row is wrong too,
  // but it is wrong in a way somebody can see and fix.
  assert.equal(stats.adopted, 0);
  assert.equal(stats.inserted, 1);
});

test('responded comes from the stage, not the checkbox', { skip }, async () => {
  await clearLeads();
  await importAirtableLeads(db, {
    fromFile: await fixture([
      // Reached rapport, so they replied - whatever the checkbox says.
      { id: 'recR1', igHandle: 'replied', conversationStage: { name: 'Mid Rapport' } },
      // Ticked by a setter on a conversation that never got an answer.
      {
        id: 'recR2',
        igHandle: 'silent',
        conversationStage: { name: 'Outreached' },
        responded: true,
      },
      // The stage settles nothing either way, so the checkbox stands.
      { id: 'recR3', igHandle: 'writtenoff', conversationStage: { name: 'DQ' }, responded: true },
    ]),
  });

  const replied = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recR1') });
  assert.equal(replied?.responded, true, 'nobody reaches rapport without replying');
  const silent = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recR2') });
  assert.equal(silent?.responded, false, 'a tick on an outreached-only lead is not a reply');
  const writtenOff = await db.query.leads.findFirst({ where: eq(leads.airtableRecordId, 'recR3') });
  assert.equal(writtenOff?.responded, true, 'dq settles nothing, so what was recorded stands');
});

test('a test run counts what a real one would do', { skip }, async () => {
  await clearLeads();
  await db.insert(leads).values({
    igHandle: 'alreadyhere',
    igHandleKey: 'alreadyhere',
    airtableRecordId: 'recHERE',
  });

  const rows = await fixture([
    { id: 'recHERE', igHandle: 'alreadyhere' },
    { id: 'recNEW', igHandle: 'brandnew' },
  ]);
  const dry = await importAirtableLeads(db, { fromFile: rows, dryRun: true });
  // The old dry run counted every record as an addition, so it always read
  // "592 added" and could never answer the only question worth asking it.
  assert.equal(dry.inserted, 1);
  assert.equal(dry.updated, 1);

  const [{ before }] = await db.select({ before: count() }).from(leads);
  assert.equal(before, 1, 'the test run wrote something');

  const real = await importAirtableLeads(db, { fromFile: rows });
  assert.equal(real.inserted, dry.inserted);
  assert.equal(real.updated, dry.updated);
});
