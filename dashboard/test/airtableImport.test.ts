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
