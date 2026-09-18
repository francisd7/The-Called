import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { eodReports, users } from '../src/db/schema.ts';
import { importSetterEod, type EodRecord } from '../src/lib/eodImport.ts';

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
  await db.delete(eodReports);
});

after(async () => {
  if (sql) await sql.end();
});

/** Mirrors the real form: a date, a setter dropdown, counts, and free text. */
const RECORDS: EodRecord[] = [
  {
    id: 'recEODone',
    fields: {
      fld5jDWoKb2orZTuD: '2026-09-14',
      fld2OkCwwD0HxibqE: { name: 'Loui' },
      fldiudXyCCIQDmfym: 30,
      fldzJSgz0TAaXspgY: 15,
      fldGk6fkHOkfSCma8: 12,
      fld2BDYFLt3nPxHf7: 0,
      fldo3Hvj53CilDZEW: 4,
      fld0yA6kmb1Meyddb: 2,
      fld3Gn3Neox6wmMje: 1200,
      fldZ3EmnqF9E1HY6r: 3000,
      fldm1lbxMrR3CBCTM: { name: 'Yes' },
      fldM2gOS4yLP14c08: 'Two booked.',
      fldkD5tccdaSnDq1R: 'Leads have no money.',
      fldwfNVOc2ZyGA7tU: 'Follow up.',
    },
  },
  {
    // The early rows predate several fields, so most of them are simply absent.
    id: 'recEODsparse',
    fields: {
      fld5jDWoKb2orZTuD: '2026-09-15',
      fld2OkCwwD0HxibqE: { name: 'Alexis' },
      fldiudXyCCIQDmfym: 0,
      fld0yA6kmb1Meyddb: 0,
    },
  },
];

test('the Airtable EOD form comes across whole', { skip }, async () => {
  const dry = await importSetterEod(db, { records: RECORDS, dryRun: true });
  assert.equal(dry.inserted, 2);
  const [{ n: afterDry }] = await db.select({ n: count() }).from(eodReports);
  assert.equal(afterDry, 0, 'a dry run must not write');

  const stats = await importSetterEod(db, { records: RECORDS });
  assert.equal(stats.inserted, 2);
  assert.equal(stats.skipped.length, 0);

  const row = await db.query.eodReports.findFirst({
    where: eq(eodReports.airtableRecordId, 'recEODone'),
  });
  assert.ok(row);
  assert.equal(row.totalOutbounds, 30);
  assert.equal(row.callsBooked, 2);
  assert.equal(row.cashCollected, '1200.00');
  assert.equal(row.revenueGenerated, '3000.00');
  assert.equal(row.win, 'Two booked.');
  assert.deepEqual(row.legacy, { saidUpdatedTracker: 'Yes' });
});

test('a blank stays blank, and a zero stays a zero', { skip }, async () => {
  await importSetterEod(db, { records: RECORDS });
  const row = await db.query.eodReports.findFirst({
    where: eq(eodReports.airtableRecordId, 'recEODsparse'),
  });
  assert.ok(row);
  assert.equal(row.totalOutbounds, 0, 'zero is an answer');
  assert.equal(row.totalFollowUps, null, 'a field never filled in is not a zero');
  assert.equal(row.cashCollected, null);
});

test('a second run updates rather than duplicating', { skip }, async () => {
  await importSetterEod(db, { records: RECORDS });
  const again = await importSetterEod(db, { records: RECORDS });
  assert.equal(again.inserted, 0);
  assert.equal(again.updated, 2);

  const [{ n }] = await db.select({ n: count() }).from(eodReports);
  assert.equal(n, 2);
});

test('a report filed in the dashboard is never overwritten by Airtable', { skip }, async () => {
  await db.delete(eodReports);
  const loui = await db.query.users.findFirst({ where: eq(users.name, 'Loui') });
  assert.ok(loui, 'expected a Loui to file as');

  // Filed in the app, so it carries no Airtable id.
  await db
    .insert(eodReports)
    .values({ userId: loui.id, reportDate: '2026-09-14', totalOutbounds: 99, win: 'Typed here.' });

  const stats = await importSetterEod(db, { records: RECORDS });
  assert.equal(stats.keptDashboard, 1);
  assert.equal(stats.inserted, 1, 'the other record should still come across');

  const kept = await db.query.eodReports.findFirst({
    where: and(eq(eodReports.userId, loui.id), eq(eodReports.reportDate, '2026-09-14')),
  });
  assert.equal(kept?.totalOutbounds, 99, 'Airtable overwrote a report somebody filed here');
  assert.equal(kept?.win, 'Typed here.');
});

test('a name nobody here goes by is reported, not guessed at', { skip }, async () => {
  await db.delete(eodReports);
  const stats = await importSetterEod(db, {
    records: [
      {
        id: 'recEODghost',
        fields: { fld5jDWoKb2orZTuD: '2026-09-14', fld2OkCwwD0HxibqE: { name: 'Someone Else' } },
      },
      { id: 'recEODnodate', fields: { fld2OkCwwD0HxibqE: { name: 'Loui' } } },
    ],
  });
  assert.equal(stats.inserted, 0);
  assert.equal(stats.skipped.length, 2);
  assert.match(stats.skipped[0], /Someone Else/);
  assert.match(stats.skipped[1], /no date/);
});

test('two Airtable rows for one day is reported, not a crash', { skip }, async () => {
  await db.delete(eodReports);
  const twice: EodRecord[] = [
    {
      id: 'recEODdupA',
      fields: {
        fld5jDWoKb2orZTuD: '2026-09-14',
        fld2OkCwwD0HxibqE: { name: 'Loui' },
        fldiudXyCCIQDmfym: 30,
      },
    },
    {
      id: 'recEODdupB',
      fields: {
        fld5jDWoKb2orZTuD: '2026-09-14',
        fld2OkCwwD0HxibqE: { name: 'Loui' },
        fldiudXyCCIQDmfym: 12,
      },
    },
  ];

  const stats = await importSetterEod(db, { records: twice });
  assert.equal(stats.inserted, 1);
  assert.equal(stats.skipped.length, 1);
  assert.match(stats.skipped[0], /already has a report for 2026-09-14/);

  const [{ n }] = await db.select({ n: count() }).from(eodReports);
  assert.equal(n, 1);
});
