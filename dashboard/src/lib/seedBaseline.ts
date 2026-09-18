import { count } from 'drizzle-orm';
import { db } from '../db';
import { offers, optionSets, users } from '../db/schema';

/**
 * The rows the app can't function without. Runs on every boot and is
 * idempotent, so a deploy is enough to set up a fresh database.
 *
 * Emails are placeholders until they're replaced. Sign-in matches on email, so
 * a placeholder simply means that person can't get in yet - it's never a
 * security hole, and it never overwrites a real address once one is set.
 */
// ADMIN_EMAIL lets the first admin be set without a code change - useful when
// the Google account someone actually signs in with isn't the one assumed here.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'francisduong7@gmail.com').trim().toLowerCase();

const PEOPLE = [
  { email: ADMIN_EMAIL, name: process.env.ADMIN_NAME ?? 'Francis', role: 'admin' as const, active: true },
  { email: 'CHANGEME.loui@example.com', name: 'Loui', role: 'setter' as const, active: true, color: 'orange' },
  { email: 'CHANGEME.alexis@example.com', name: 'Alexis', role: 'setter' as const, active: true, color: 'blue' },
  // Closers get a row so bookings can be attributed to them, but no sign-in:
  // they read pre-call notes in Discord. Their email must match the one on
  // their Calendly account or bookings won't attribute.
  { email: 'CHANGEME.nigel@example.com', name: 'Nigel', role: 'closer' as const, active: false },
  { email: 'CHANGEME.andrew@example.com', name: 'Andrew', role: 'closer' as const, active: false },
];

const OFFERS = [
  {
    key: 'brotherhood',
    label: 'The Called Brotherhood Breakthrough ($1k)',
    schedulingUrl: 'https://calendly.com/nigeldaleycoaching/the-called-brotherhood-breakthrough',
    sortOrder: 1,
  },
  {
    key: 'personal_branding',
    label: 'Personal Branding Consultation',
    schedulingUrl: 'https://calendly.com/nigeldaleycoaching/consultation-call',
    sortOrder: 2,
  },
  {
    key: 'fitness',
    label: 'Fitness Coaching Consultation',
    schedulingUrl:
      'https://calendly.com/nigeldaleycoaching/the-called-fitness-coaching-consultation-call',
    sortOrder: 3,
  },
];

const BASE_OPTIONS: Array<[string, string, string]> = [
  ['conversation_stage', 'not_outreached', 'Not outreached'],
  ['conversation_stage', 'outreached', 'Outreached'],
  ['conversation_stage', 'rapport', 'Rapport'],
  ['conversation_stage', 'business_talk', 'Business Talk'],
  ['conversation_stage', 'proposed_call', 'Proposed Call'],
  ['conversation_stage', 'call_booked', 'Call Booked'],
  ['conversation_stage', 'closed', 'Closed'],
  ['conversation_stage', 'follow_up_later', 'Follow Up Later'],
  ['conversation_stage', 'no_response', 'No Response'],
  ['conversation_stage', 'bad_fit', 'Bad Fit'],
  ['lead_quality', 'excellent', 'Excellent'],
  ['lead_quality', 'great', 'Great'],
  ['lead_quality', 'good', 'Good'],
  ['lead_quality', 'mid', 'Mid'],
  ['lead_quality', 'low', 'Low'],
  // Always available, so a source that doesn't fit the list still gets recorded
  // rather than left blank.
  ['lead_source', 'other', 'Other'],
  ['icp', 'yes', 'Yes'],
  ['icp', 'maybe', 'Maybe'],
  ['icp', 'no', 'No'],
];

export async function seedBaseline() {
  // People are seeded ONCE, on an empty table. Upserting them on every boot
  // looked right but wasn't: the upsert keys on email, so as soon as someone
  // replaced a placeholder address the next deploy found no conflict and
  // inserted the placeholder back alongside the real row - two Nigels, and the
  // wrong one attached to the bookings.
  const [{ existing }] = await db.select({ existing: count() }).from(users);
  if (existing === 0) {
    await db.insert(users).values(PEOPLE);
    console.log(`Seeded ${PEOPLE.length} people.`);
  }

  // The admin row is the exception, always reconciled: it's the only way back
  // in, and locking yourself out of your own dashboard should not be possible.
  await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      name: process.env.ADMIN_NAME ?? 'Francis',
      role: 'admin',
      active: true,
    })
    .onConflictDoUpdate({ target: users.email, set: { role: 'admin', active: true } });

  for (const offer of OFFERS) {
    await db
      .insert(offers)
      .values(offer)
      .onConflictDoUpdate({
        target: offers.key,
        // eventTypeUri is left alone - it's set by the Calendly setup, not here.
        set: { label: offer.label, schedulingUrl: offer.schedulingUrl },
      });
  }

  let i = 0;
  for (const [kind, value, label] of BASE_OPTIONS) {
    await db.insert(optionSets).values({ kind, value, label, sortOrder: i++ }).onConflictDoNothing();
  }

  console.log(`Baseline seed applied. Admin sign-in is ${ADMIN_EMAIL}.`);
}
