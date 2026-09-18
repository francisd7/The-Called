import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count, eq, isNotNull, isNull } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leadNotes, leads, optionSets, users } from '../src/db/schema.ts';
import { importAirtableLeads } from '../src/lib/airtableImport.ts';

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
