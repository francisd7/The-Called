import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { users } from '../src/db/schema.ts';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL is not set';

// These tests empty the users table, which the lead tests populate and
// reference by foreign key. They get a throwaway database of their own so the
// two can't collide and suite order stops mattering.
const dbName = `seed_test_${Date.now()}`;
let admin: ReturnType<typeof postgres> | undefined;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

before(async () => {
  if (!url) return;
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  admin = postgres(parsed.toString(), { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);

  const ownUrl = new URL(url);
  ownUrl.pathname = `/${dbName}`;
  sql = postgres(ownUrl.toString(), { max: 2 });
  db = drizzle(sql, { schema });
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
});

after(async () => {
  if (sql) await sql.end();
  if (admin) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});

/**
 * Mirrors seedBaseline's people logic against the injected db. The real module
 * imports the app's singleton connection, which a test can't point elsewhere.
 */
async function seedPeople(adminEmail: string) {
  const PEOPLE = [
    { email: adminEmail, name: 'Francis', role: 'admin' as const, active: true },
    { email: 'CHANGEME.loui@example.com', name: 'Loui', role: 'setter' as const, active: true },
    { email: 'CHANGEME.nigel@example.com', name: 'Nigel', role: 'closer' as const, active: false },
  ];

  const [{ existing }] = await db.select({ existing: count() }).from(users);
  if (existing === 0) await db.insert(users).values(PEOPLE);

  await db
    .insert(users)
    .values({ email: adminEmail, name: 'Francis', role: 'admin', active: true })
    .onConflictDoUpdate({ target: users.email, set: { role: 'admin', active: true } });
}

const ADMIN = 'admin@example.com';

test('seeds the people on an empty table', { skip }, async () => {
  await db.delete(users);
  await seedPeople(ADMIN);
  const [{ n }] = await db.select({ n: count() }).from(users);
  assert.equal(n, 3);
});

test('a replaced placeholder email is not resurrected by the next boot', { skip }, async () => {
  // The bug this guards: seeding upserted on email, so once Nigel's placeholder
  // was replaced with his real Calendly address the next deploy found no
  // conflict and inserted the placeholder back. Two Nigels, and bookings
  // attaching to whichever one the query happened to return.
  await db
    .update(users)
    .set({ email: 'nigel.real@example.com' })
    .where(eq(users.email, 'CHANGEME.nigel@example.com'));

  await seedPeople(ADMIN);

  const nigels = await db.select().from(users).where(eq(users.name, 'Nigel'));
  assert.equal(nigels.length, 1, 'expected exactly one Nigel');
  assert.equal(nigels[0].email, 'nigel.real@example.com');

  const [{ n }] = await db.select({ n: count() }).from(users);
  assert.equal(n, 3, 'no extra rows');
});

test('a deactivated person stays deactivated across deploys', { skip }, async () => {
  await db.update(users).set({ active: false }).where(eq(users.name, 'Loui'));
  await seedPeople(ADMIN);
  const loui = await db.query.users.findFirst({ where: eq(users.name, 'Loui') });
  assert.equal(loui?.active, false, 'a deploy must not re-enable someone who was removed');
});

test('the admin can never be locked out by a deploy', { skip }, async () => {
  // If the only way back in could be switched off, a bad edit would end the
  // ability to fix it.
  await db.update(users).set({ active: false, role: 'setter' }).where(eq(users.email, ADMIN));
  await seedPeople(ADMIN);
  const admin = await db.query.users.findFirst({ where: eq(users.email, ADMIN) });
  assert.equal(admin?.active, true);
  assert.equal(admin?.role, 'admin');
});
