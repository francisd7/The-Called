import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leads, users } from '../src/db/schema.ts';
import { buildCsv } from '../src/lib/exports.ts';
import { restoreTable } from '../src/lib/restore.ts';

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
  await db.delete(leads);
});

/** A lead with the kinds of value that break a naive round trip. */
async function awkwardLead() {
  const [row] = await db
    .insert(leads)
    .values({
      igHandle: '=gavin.r',
      igHandleKey: 'gavin.r',
      name: 'Gavin "Gav" Roberts, Jr',
      triageNotes: 'Budget: 5k, maybe more\nSaid "let me ask my wife"',
      followUps: 3,
      callBooked: true,
      closed: true,
      cashCollected: '5000.50',
      callScheduledFor: new Date('2026-09-22T16:00:00Z'),
      calendlyAnswers: { q: 'why now?', a: 'tired of starting over' },
      isTest: false,
    })
    .returning();
  return row;
}

test('a lead survives export and restore unchanged', { skip }, async () => {
  const before = await awkwardLead();
  const csv = await buildCsv(db, 'leads');

  await db.delete(leads);
  const stats = await restoreTable(db, 'leads', csv);

  assert.equal(stats.read, 1);
  assert.equal(stats.inserted, 1);

  const after = await db.query.leads.findFirst({ where: eq(leads.id, before.id) });
  assert.ok(after, 'the lead should be back');
  assert.equal(after.igHandle, '=gavin.r', 'the formula guard must come back off');
  assert.equal(after.name, 'Gavin "Gav" Roberts, Jr');
  assert.equal(after.triageNotes, before.triageNotes, 'commas, quotes and newlines intact');
  assert.equal(after.followUps, 3, 'a number is a number');
  assert.equal(after.callBooked, true, 'a boolean is a boolean');
  assert.equal(after.cashCollected, '5000.50', 'money keeps its cents');
  assert.deepEqual(after.calendlyAnswers, before.calendlyAnswers, 'json comes back as json');
  assert.equal(
    after.callScheduledFor?.toISOString(),
    before.callScheduledFor?.toISOString(),
    'the call is at the same moment'
  );
});

test('the whole table comes back, not just one row', { skip }, async () => {
  for (let i = 0; i < 25; i++) {
    await db.insert(leads).values({ igHandle: `lead${i}`, igHandleKey: `lead${i}`, isTest: false });
  }
  const csv = await buildCsv(db, 'leads');
  await db.delete(leads);

  const stats = await restoreTable(db, 'leads', csv);
  assert.equal(stats.inserted, 25);
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 25);
});

test('a restore never overwrites live work by default', { skip }, async () => {
  // The usual reason to restore is that something is missing. A week-old file
  // dropped over current rows would undo a week.
  const lead = await awkwardLead();
  const csv = await buildCsv(db, 'leads');

  await db.update(leads).set({ triageNotes: 'newer note nobody wants to lose' }).where(eq(leads.id, lead.id));
  const stats = await restoreTable(db, 'leads', csv);

  assert.equal(stats.inserted, 0);
  assert.equal(stats.skipped, 1);
  const after = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) });
  assert.equal(after?.triageNotes, 'newer note nobody wants to lose');
});

test('overwrite is available when that is what you actually mean', { skip }, async () => {
  const lead = await awkwardLead();
  const csv = await buildCsv(db, 'leads');
  await db.update(leads).set({ triageNotes: 'scribble' }).where(eq(leads.id, lead.id));

  const stats = await restoreTable(db, 'leads', csv, { overwrite: true });
  assert.equal(stats.overwritten, 1);
  const after = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) });
  assert.equal(after?.triageNotes, lead.triageNotes);
});

test('a dry run reports without writing', { skip }, async () => {
  await awkwardLead();
  const csv = await buildCsv(db, 'leads');
  await db.delete(leads);

  const stats = await restoreTable(db, 'leads', csv, { dryRun: true });
  assert.equal(stats.inserted, 1);
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 0, 'a dry run that writes is not a dry run');
});

test('running a restore twice changes nothing the second time', { skip }, async () => {
  await awkwardLead();
  const csv = await buildCsv(db, 'leads');
  await db.delete(leads);

  await restoreTable(db, 'leads', csv);
  const again = await restoreTable(db, 'leads', csv);
  assert.equal(again.inserted, 0);
  assert.equal(again.skipped, 1);
});

test('a file that is not one of ours is refused, not half-applied', { skip }, async () => {
  const stats = await restoreTable(db, 'leads', 'name,email\r\nBob,bob@example.com\r\n');
  assert.equal(stats.inserted, 0);
  assert.ok(stats.problems.some((p) => p.includes('No id column')));
});

test('an empty file says so', { skip }, async () => {
  const stats = await restoreTable(db, 'leads', '');
  assert.ok(stats.problems.some((p) => p.includes('empty')));
});

test('a column that no longer exists is skipped, not fatal', { skip }, async () => {
  // An older backup can still be worth restoring.
  const lead = await awkwardLead();
  const csv = await buildCsv(db, 'leads');
  await db.delete(leads);

  const rows = csv.split('\r\n');
  const withExtra = [`${rows[0]},retiredColumn`, `${rows[1]},something`, ...rows.slice(2)].join('\r\n');
  const stats = await restoreTable(db, 'leads', withExtra);

  assert.equal(stats.inserted, 1, 'the row still goes back in');
  assert.ok(stats.problems.some((p) => p.includes('retiredColumn')));
  assert.ok(await db.query.leads.findFirst({ where: eq(leads.id, lead.id) }));
});

test('people restore too, since leads point at them', { skip }, async () => {
  const csv = await buildCsv(db, 'people');
  const stats = await restoreTable(db, 'people', csv);
  const [{ n }] = await db.select({ n: count() }).from(users);
  assert.equal(stats.read, n, 'every person in the file was read');
  assert.equal(stats.skipped, n, 'and none overwritten, because they are all still here');
});
