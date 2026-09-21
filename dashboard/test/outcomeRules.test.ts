import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leads, postCallReports } from '../src/db/schema.ts';
import { awaitingOutcome } from '../src/lib/outcomeRules.ts';

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
  await db.delete(postCallReports);
  await db.delete(leads);
});

const HOUR = 60 * 60 * 1000;
const yesterday = () => new Date(Date.now() - 24 * HOUR);
const tomorrow = () => new Date(Date.now() + 24 * HOUR);

/** A call that happened yesterday and nobody has said anything about. */
async function pastCall(over: Record<string, unknown> = {}) {
  await db.insert(leads).values({
    igHandle: `lead-${Math.random().toString(36).slice(2, 8)}`,
    callBooked: true,
    callScheduledFor: yesterday(),
    ...over,
  });
}

async function waiting(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(leads).where(awaitingOutcome());
  return n;
}

test('a call nobody has said anything about is waiting', { skip }, async () => {
  await pastCall();
  assert.equal(await waiting(), 1);
});

test('a call that has not happened yet is not waiting', { skip }, async () => {
  await pastCall({ callScheduledFor: tomorrow() });
  assert.equal(await waiting(), 0);
});

test('a call still in progress gets an hour before it nags', { skip }, async () => {
  await pastCall({ callScheduledFor: new Date(Date.now() - 10 * 60 * 1000) });
  assert.equal(await waiting(), 0);
});

test('a cancelled call is not waiting on anything', { skip }, async () => {
  await pastCall({ callCancelled: true });
  assert.equal(await waiting(), 0);
});

test('a test booking never nags', { skip }, async () => {
  await pastCall({ isTest: true });
  assert.equal(await waiting(), 0);
});

// The four ways an outcome reaches a lead. Only the first stamps
// outcomeLoggedAt, which is why asking about it alone put 28 settled calls on
// the front page and called them unrecorded.
test('an outcome somebody logged here settles it', { skip }, async () => {
  await pastCall({ outcomeLoggedAt: new Date(), callOutcome: 'no_close' });
  assert.equal(await waiting(), 0);
});

test('an outcome from a post-call report settles it', { skip }, async () => {
  await pastCall({ postCallRecordId: 'recReport1' });
  assert.equal(await waiting(), 0);
});

test('a close settles it, whoever recorded the close', { skip }, async () => {
  await pastCall({ closed: true, cashCollected: '1000.00' });
  assert.equal(await waiting(), 0);
});

test('knowing they showed settles it', { skip }, async () => {
  await pastCall({ showed: true });
  assert.equal(await waiting(), 0);
});

test('an unticked Airtable checkbox settles nothing', { skip }, async () => {
  // The import wrote false into both for every row it brought across. Reading
  // that as an answer would empty the list permanently - the same bug the
  // other way up, and much harder to spot.
  await pastCall({ closed: false, showed: false });
  assert.equal(await waiting(), 1, 'a false from the import was read as a recorded outcome');
});
