import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { count, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { leadEvents, leads, offers } from '../src/db/schema.ts';
import { backfillCalendly, type BackfillItem } from '../src/lib/calendlyBackfill.ts';

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

  // The backfill only accepts bookings on a linked offer, so one has to exist
  // for any of this to be reachable at all.
  await db
    .insert(offers)
    .values({
      key: 'test_brotherhood',
      label: 'Test Brotherhood',
      schedulingUrl: 'https://calendly.com/test/brotherhood',
      eventTypeUri: 'https://api.calendly.com/event_types/brotherhood',
    })
    .onConflictDoNothing({ target: offers.key });
});

after(async () => {
  if (sql) await sql.end();
});

const event = (uri: string, start: string, status = 'active', reason?: string) => ({
  uri,
  status,
  start_time: start,
  event_type: 'https://api.calendly.com/event_types/brotherhood',
  event_memberships: [{ user_email: 'nigel@thecalled.test', user_name: 'Nigel' }],
  ...(reason ? { cancellation: { reason } } : {}),
});

const invitee = (name: string, email: string, handle?: string) => ({
  uri: `https://api.calendly.com/invitees/${name}`,
  name,
  email,
  ...(handle
    ? { questions_and_answers: [{ question: 'Instagram handle', answer: handle, position: 0 }] }
    : {}),
});

test('a booking with no lead behind it gets one', { skip }, async () => {
  await db.delete(leads);
  const items: BackfillItem[] = [
    { event: event('ev/1', '2026-09-02T15:00:00Z'), invitee: invitee('Ghost One', 'g1@x.test') },
  ];

  const dry = await backfillCalendly(db, { items, dryRun: true });
  assert.equal(dry.created, 1);
  const [{ n: afterDry }] = await db.select({ n: count() }).from(leads);
  assert.equal(afterDry, 0, 'a dry run must not write');

  const stats = await backfillCalendly(db, { items });
  assert.equal(stats.created, 1);

  const lead = await db.query.leads.findFirst({ where: eq(leads.calendlyEventUri, 'ev/1') });
  assert.ok(lead, 'the call happened, so there should be a lead for it');
  assert.equal(lead.callBooked, true);
  assert.equal(lead.responded, true, 'anyone who books has replied');
  assert.equal(lead.needsHandle, true, 'no handle on the form, so flagged not invented');
  assert.ok(lead.callScheduledFor);
});

test('a booking finds the lead by the handle on the form', { skip }, async () => {
  await db.delete(leads);
  const [existing] = await db
    .insert(leads)
    .values({ igHandle: 'realprospect', igHandleKey: 'realprospect' })
    .returning({ id: leads.id });

  const stats = await backfillCalendly(db, {
    items: [
      {
        event: event('ev/2', '2026-09-03T15:00:00Z'),
        invitee: invitee('Real Prospect', 'rp@x.test', '@realprospect'),
      },
    ],
  });

  assert.equal(stats.matched, 1);
  assert.equal(stats.created, 0);
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, existing.id) });
  assert.equal(lead?.callBooked, true);
  assert.equal(lead?.name, 'Real Prospect');
  assert.equal(lead?.email, 'rp@x.test');
});

test('a cancelled booking comes across as cancelled, with its reason', { skip }, async () => {
  await db.delete(leads);
  const stats = await backfillCalendly(db, {
    items: [
      {
        event: event('ev/3', '2026-09-04T15:00:00Z', 'canceled', 'Something came up'),
        invitee: invitee('Called Off', 'co@x.test'),
      },
    ],
  });

  assert.equal(stats.cancelled, 1);
  const lead = await db.query.leads.findFirst({ where: eq(leads.calendlyEventUri, 'ev/3') });
  assert.equal(lead?.callCancelled, true);
  assert.equal(lead?.cancelReason, 'Something came up');
  assert.ok(lead?.callCancelledAt);
});

test('booked, cancelled and rebooked ends on the latest booking', { skip }, async () => {
  await db.delete(leads);
  const [existing] = await db
    .insert(leads)
    .values({ igHandle: 'rebooker', igHandleKey: 'rebooker' })
    .returning({ id: leads.id });

  // Deliberately out of order: the backfill has to sort them itself.
  await backfillCalendly(db, {
    items: [
      {
        event: event('ev/5', '2026-09-12T15:00:00Z'),
        invitee: invitee('Re Booker', 'rb@x.test', '@rebooker'),
      },
      {
        event: event('ev/4', '2026-09-05T15:00:00Z', 'canceled', 'Moved it'),
        invitee: invitee('Re Booker', 'rb@x.test', '@rebooker'),
      },
    ],
  });

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, existing.id) });
  assert.equal(lead?.calendlyEventUri, 'ev/5', 'the newer booking should be the one on the lead');
  assert.equal(lead?.callCancelled, false, 'a rebooking clears the cancellation');
  assert.equal(lead?.cancelReason, null);
});

test('a second run updates rather than creating a second lead', { skip }, async () => {
  await db.delete(leads);
  const items: BackfillItem[] = [
    { event: event('ev/6', '2026-09-06T15:00:00Z'), invitee: invitee('Once Only', 'oo@x.test') },
  ];
  await backfillCalendly(db, { items });
  const again = await backfillCalendly(db, { items });

  assert.equal(again.created, 0);
  assert.equal(again.updated, 1);
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 1);
});

test('work a setter has already done is never cleared', { skip }, async () => {
  await db.delete(leads);
  const [existing] = await db
    .insert(leads)
    .values({
      igHandle: 'alreadydone',
      igHandleKey: 'alreadydone',
      confirmed: true,
      triaged: true,
      triageNotes: 'Warmed up, knows the price.',
    })
    .returning({ id: leads.id });

  await backfillCalendly(db, {
    items: [
      {
        event: event('ev/7', '2026-09-07T15:00:00Z'),
        invitee: invitee('Already Done', 'ad@x.test', '@alreadydone'),
      },
    ],
  });

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, existing.id) });
  assert.equal(lead?.confirmed, true, 'a historical booking should not undo a confirmation');
  assert.equal(lead?.triaged, true);
  assert.equal(lead?.triageNotes, 'Warmed up, knows the price.');
});

test('a booking on a link that is not one of ours is left alone', { skip }, async () => {
  await db.delete(leads);
  const stats = await backfillCalendly(db, {
    items: [
      {
        event: {
          uri: 'ev/foreign',
          status: 'active',
          start_time: '2026-09-08T15:00:00Z',
          // Somebody's own meeting on the same Calendly account.
          event_type: 'https://api.calendly.com/event_types/internal-sync',
          event_memberships: [{ user_email: 'nigel@thecalled.test', user_name: 'Nigel' }],
        },
        invitee: invitee('Internal Person', 'ip@x.test'),
      },
    ],
  });

  assert.equal(stats.notOurs, 1);
  assert.equal(stats.created, 0, 'an internal meeting is not a lead');
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 0);
});

test('a lead an earlier run invented from a foreign link is removed', { skip }, async () => {
  await db.delete(leads);
  const foreign = {
    uri: 'ev/foreign2',
    status: 'active',
    start_time: '2026-09-09T15:00:00Z',
    event_type: 'https://api.calendly.com/event_types/internal-sync',
  };

  // Stand in for what the unfiltered version wrote: a lead it created itself.
  const [invented] = await db
    .insert(leads)
    .values({
      igHandle: 'Internal Person',
      needsHandle: true,
      callBooked: true,
      calendlyEventUri: foreign.uri,
    })
    .returning({ id: leads.id });
  await db.insert(leadEvents).values({
    leadId: invented.id,
    type: 'created',
    meta: { source: 'calendly_backfill' } as never,
  });

  const dry = await backfillCalendly(db, {
    items: [{ event: foreign, invitee: invitee('Internal Person', 'ip@x.test') }],
    dryRun: true,
  });
  assert.equal(dry.removed, 1);
  const [{ n: stillThere }] = await db.select({ n: count() }).from(leads);
  assert.equal(stillThere, 1, 'a dry run must not delete anything');

  const stats = await backfillCalendly(db, {
    items: [{ event: foreign, invitee: invitee('Internal Person', 'ip@x.test') }],
  });
  assert.equal(stats.removed, 1);
  const [{ n }] = await db.select({ n: count() }).from(leads);
  assert.equal(n, 0);
});

test('a real lead keeps everything but the booking that was not ours', { skip }, async () => {
  await db.delete(leads);
  const foreign = {
    uri: 'ev/foreign3',
    status: 'active',
    start_time: '2026-09-10T15:00:00Z',
    event_type: 'https://api.calendly.com/event_types/internal-sync',
  };

  const [real] = await db
    .insert(leads)
    .values({
      igHandle: 'realperson',
      igHandleKey: 'realperson',
      triaged: true,
      triageNotes: 'Knows the price.',
      callBooked: true,
      calendlyEventUri: foreign.uri,
    })
    .returning({ id: leads.id });

  const stats = await backfillCalendly(db, {
    items: [{ event: foreign, invitee: invitee('Real Person', 'rp@x.test') }],
  });

  assert.equal(stats.cleared, 1);
  assert.equal(stats.removed, 0);
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, real.id) });
  assert.ok(lead, 'a lead somebody has worked is never deleted');
  assert.equal(lead.callBooked, false);
  assert.equal(lead.calendlyEventUri, null);
  assert.equal(lead.triaged, true, "the setter's work stays");
  assert.equal(lead.triageNotes, 'Knows the price.');
});

test('with no offer linked, the backfill refuses rather than taking everything', { skip }, async () => {
  await db.update(offers).set({ eventTypeUri: null });
  await assert.rejects(
    () => backfillCalendly(db, { items: [] }),
    /Connect Calendly/,
    'an empty filter must not mean "accept the whole account"'
  );
  await db
    .update(offers)
    .set({ eventTypeUri: 'https://api.calendly.com/event_types/brotherhood' })
    .where(eq(offers.key, 'test_brotherhood'));
});
