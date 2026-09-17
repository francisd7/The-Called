/**
 * Creates the rows the app can't work without: the five people, the three
 * offers, and the baseline dropdowns. Safe to re-run - everything upserts.
 *
 *   node --experimental-strip-types scripts/seed.ts
 */
import { db, sql } from './db.ts';
import { offers, optionSets, users } from '../src/db/schema.ts';

// Closers are seeded inactive: `active` is what the sign-in allowlist checks,
// so Nigel and Andrew exist as rows calls can be attributed to without either
// of them getting a dashboard login. They read pre-call notes in Discord.
// Their emails must match their Calendly account email or bookings won't
// attribute to them - see resolveCloser() in the webhook route.
const PEOPLE = [
  { email: 'francisduong7@gmail.com', name: 'Francis', role: 'admin', active: true },
  { email: 'CHANGEME.loui@example.com', name: 'Loui', role: 'setter', active: true },
  { email: 'CHANGEME.alexis@example.com', name: 'Alexis', role: 'setter', active: true },
  { email: 'CHANGEME.nigel@example.com', name: 'Nigel', role: 'closer', active: false },
  { email: 'CHANGEME.andrew@example.com', name: 'Andrew', role: 'closer', active: false },
] as const;

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

// Only the stages worth starting from. The rest of the vocabulary is derived
// from whatever the Airtable import actually finds in use, so dead options
// don't get carried over.
const BASE_OPTIONS: Array<{ kind: string; value: string; label: string }> = [
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
  ['icp', 'yes', 'Yes'],
  ['icp', 'maybe', 'Maybe'],
  ['icp', 'no', 'No'],
].map(([kind, value, label]) => ({ kind, value, label }));

async function main() {
  for (const person of PEOPLE) {
    await db
      .insert(users)
      .values({ ...person })
      .onConflictDoUpdate({
        target: users.email,
        // Deliberately does not touch `active`: a person deactivated in the app
        // should not come back the next time this runs.
        set: { name: person.name, role: person.role },
      });
  }
  console.log(`✓ ${PEOPLE.length} people`);

  for (const offer of OFFERS) {
    await db
      .insert(offers)
      .values(offer)
      .onConflictDoUpdate({
        target: offers.key,
        set: { label: offer.label, schedulingUrl: offer.schedulingUrl },
      });
  }
  console.log(`✓ ${OFFERS.length} offers`);

  let i = 0;
  for (const option of BASE_OPTIONS) {
    await db
      .insert(optionSets)
      .values({ ...option, sortOrder: i++ })
      .onConflictDoNothing();
  }
  console.log(`✓ ${BASE_OPTIONS.length} baseline options`);

  const placeholders = PEOPLE.filter((p) => p.email.startsWith('CHANGEME'));
  if (placeholders.length > 0) {
    console.log(
      `\n⚠  ${placeholders.length} placeholder emails still need real addresses ` +
        `(${placeholders.map((p) => p.name).join(', ')}).\n` +
        `   Setters can't sign in and bookings won't attribute to a closer until these are real.`
    );
  }
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
