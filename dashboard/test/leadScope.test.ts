import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leads, users } from '../src/db/schema.ts';
import { archivedLead, liveLead } from '../src/lib/leadScope.ts';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

const dbName = `scope_test_${Date.now()}`;
let admin: ReturnType<typeof postgres> | undefined;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let setterId: string;

before(async () => {
  if (!url) return;
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run destructive tests against ${host}.`);
  }
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  admin = postgres(parsed.toString(), { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);

  const own = new URL(url);
  own.pathname = `/${dbName}`;
  sql = postgres(own.toString(), { max: 2 });
  db = drizzle(sql, { schema });
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });

  const [u] = await db
    .insert(users)
    .values({ email: 'setter@t.local', name: 'Setter', role: 'setter', active: true })
    .returning({ id: users.id });
  setterId = u.id;
});

after(async () => {
  if (sql) await sql.end();
  if (admin) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});

const seed = async (over: Record<string, unknown> = {}) => {
  const [row] = await db
    .insert(leads)
    .values({ igHandle: `h${Math.random().toString(36).slice(2, 9)}`, setterId, ...over })
    .returning({ id: leads.id });
  return row.id;
};

const live = async () => (await db.select({ n: count() }).from(leads).where(liveLead))[0].n;

test('an archived lead leaves the live set', { skip }, async () => {
  await db.delete(leads);
  const id = await seed();
  assert.equal(await live(), 1);

  await db.update(leads).set({ archivedAt: new Date() }).where(eq(leads.id, id));
  assert.equal(await live(), 0, 'archived leads must not count anywhere a person reads');
});

test('restoring puts it back', { skip }, async () => {
  await db.delete(leads);
  const id = await seed({ archivedAt: new Date() });
  assert.equal(await live(), 0);

  await db.update(leads).set({ archivedAt: null }).where(eq(leads.id, id));
  assert.equal(await live(), 1);
});

test('archived and live are exclusive, and test rows are in neither', { skip }, async () => {
  // A test row is excluded from both, so "archived" never becomes a place the
  // Try the booking flow rows quietly pile up.
  await db.delete(leads);
  await seed();
  await seed({ archivedAt: new Date() });
  await seed({ isTest: true });
  await seed({ isTest: true, archivedAt: new Date() });

  const [{ n: liveN }] = await db.select({ n: count() }).from(leads).where(liveLead);
  const [{ n: archN }] = await db.select({ n: count() }).from(leads).where(archivedLead);
  assert.equal(liveN, 1);
  assert.equal(archN, 1);
});

test('the archived row is still there to be matched against', { skip }, async () => {
  // The whole reason this is an archive and not a delete: the next Airtable
  // import has to find it, or it creates the same junk again without the notes.
  await db.delete(leads);
  const id = await seed({ igHandle: 'spammer', archivedAt: new Date() });

  const found = await db.query.leads.findFirst({
    where: and(eq(leads.igHandle, 'spammer'), eq(leads.isTest, false)),
  });
  assert.equal(found?.id, id, 'an import lookup must still see it');
});
