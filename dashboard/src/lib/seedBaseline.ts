import { and, count, eq } from "drizzle-orm";
import { db } from "../db";
import { offers, optionSets, users } from "../db/schema";
import { SETTER_EMAILS } from "./people";

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
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "francisduong7@gmail.com")
  .trim()
  .toLowerCase();

const byName = (n: string) => SETTER_EMAILS.find((p) => p.name === n)!.email;

const PEOPLE = [
  {
    email: ADMIN_EMAIL,
    name: process.env.ADMIN_NAME ?? "Francis",
    role: "admin" as const,
    active: true,
  },
  {
    email: byName("Loui"),
    name: "Loui",
    role: "setter" as const,
    active: true,
    color: "orange",
  },
  {
    email: byName("Alexis"),
    name: "Alexis",
    role: "setter" as const,
    active: true,
    color: "blue",
  },
  // Closers get a row so bookings can be attributed to them, and are active
  // because they are on the team and have to appear in the Closer dropdown.
  // They still cannot sign in - that is refused by role in src/lib/access.ts,
  // not by this flag. Marking them inactive to keep them out was what took
  // their names out of the one place a setter has to pick between them.
  // Their email must match the one on their Calendly account or bookings
  // won't attribute.
  {
    email: "CHANGEME.nigel@example.com",
    name: "Nigel",
    role: "closer" as const,
    active: true,
  },
  {
    email: "CHANGEME.andrew@example.com",
    name: "Andrew",
    role: "closer" as const,
    active: true,
  },
];

const OFFERS = [
  {
    key: "brotherhood",
    label: "The Called Brotherhood Breakthrough ($1k)",
    schedulingUrl:
      "https://calendly.com/nigeldaleycoaching/the-called-brotherhood-breakthrough",
    sortOrder: 1,
  },
  {
    key: "personal_branding",
    label: "Personal Branding Consultation",
    schedulingUrl: "https://calendly.com/nigeldaleycoaching/consultation-call",
    sortOrder: 2,
  },
  {
    key: "fitness",
    label: "Fitness Coaching Consultation",
    schedulingUrl:
      "https://calendly.com/nigeldaleycoaching/the-called-fitness-coaching-consultation-call",
    sortOrder: 3,
  },
];

const BASE_OPTIONS: Array<[string, string, string]> = [
  ["conversation_stage", "not_outreached", "Not outreached"],
  ["conversation_stage", "outreached", "Outreached"],
  ["conversation_stage", "rapport", "Rapport"],
  ["conversation_stage", "business_talk", "Business Talk"],
  ["conversation_stage", "proposed_call", "Proposed Call"],
  ["conversation_stage", "call_booked", "Call Booked"],
  ["conversation_stage", "closed", "Closed"],
  ["conversation_stage", "follow_up_later", "Follow Up Later"],
  ["conversation_stage", "no_response", "No Response"],
  ["conversation_stage", "bad_fit", "Bad Fit"],
  ["lead_quality", "excellent", "Excellent"],
  ["lead_quality", "great", "Great"],
  ["lead_quality", "good", "Good"],
  ["lead_quality", "mid", "Mid"],
  ["lead_quality", "low", "Low"],
  // Always available, so a source that doesn't fit the list still gets recorded
  // rather than left blank.
  ["lead_source", "other", "Other"],
  // Carried over from the Airtable Post Call table so the vocabulary the team
  // already uses survives the move.
  ["call_outcome", "closed", "Closed"],
  ["call_outcome", "no_close", "No Close"],
  ["call_outcome", "no_show", "No Show"],
  ["call_outcome", "rescheduled", "Rescheduled"],
  ["call_outcome", "follow_up_scheduled", "Follow Up Scheduled"],
  ["call_outcome", "cancelled", "Cancelled"],
  // No cancel reasons are seeded. The team already had their own, brought
  // across by the Airtable import, and a seeded set only duplicated them -
  // "Cannot afford it" beside "No Money", "Stopped replying" beside
  // "Unresponsive". Theirs is the vocabulary they report on.
  ["tier", "the_called", "The Called"],
  ["tier", "foundations", "Foundations"],
  ["tier", "momentum", "Momentum"],
  ["tier", "inner_circle", "Inner Circle"],
  ["payment_method", "cash", "Cash"],
  ["payment_method", "sezzle", "Sezzle"],
  ["payment_method", "splitit", "Splitit"],
  ["payment_method", "klarna", "Klarna"],
  ["payment_method", "affirm", "Affirm"],
  ["payment_method", "claritypay", "Claritypay"],
  ["payment_method", "in_house", "In-house financing"],
  ["payment_method", "credit_card", "Credit card"],
  ["payment_method", "whop", "Whop"],
  ["icp", "yes", "Yes"],
  ["icp", "maybe", "Maybe"],
  ["icp", "no", "No"],
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

  // The two setters were seeded with placeholders before anyone had their
  // addresses. The rows already exist by now, so the list above only reaches a
  // fresh database - these replace the placeholder in one that is already
  // running. Matched on the placeholder, never the name, so an address typed
  // into Admin -> People is never overwritten by a later deploy.
  //
  // Both halves are checked first because a failed seed is a failed boot: if
  // somebody adds the real address as a second row rather than editing the
  // first, the update would collide with the unique index on email and take
  // the whole app down with it. Skipping is always the safe answer - the
  // address is already in, which is the point.
  for (const { placeholder, email: real } of SETTER_EMAILS) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, real));
    if (taken) continue;
    const stale = await db
      .update(users)
      .set({ email: real })
      .where(eq(users.email, placeholder))
      .returning({ name: users.name });
    if (stale.length > 0)
      console.log(`Set ${stale[0].name}'s address to ${real}.`);
  }

  // Closers seeded before the sign-in rule moved to access.ts are sitting
  // inactive, which keeps them out of the Closer dropdown. Nothing else turns
  // a closer inactive on purpose - deactivating one who has left is done by
  // changing their role or removing them - so this is safe to reconcile.
  await db
    .update(users)
    .set({ active: true })
    .where(and(eq(users.role, "closer"), eq(users.active, false)));

  // The admin row is the exception, always reconciled: it's the only way back
  // in, and locking yourself out of your own dashboard should not be possible.
  await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      name: process.env.ADMIN_NAME ?? "Francis",
      role: "admin",
      active: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { role: "admin", active: true },
    });

  for (const offer of OFFERS) {
    await db
      .insert(offers)
      .values(offer)
      .onConflictDoUpdate({
        target: offers.key,
        // The label only. schedulingUrl and eventTypeUri are both left alone:
        // the first is corrected on Admin -> Setup when a link changes in
        // Calendly, the second is set by Connect Calendly. Rewriting the link
        // here on every boot meant a wrong one could not be fixed at all - any
        // correction lasted until the next deploy, and the first thing a
        // setter reported after launch was one of them 404ing.
        set: { label: offer.label },
      });
  }

  let i = 0;
  for (const [kind, value, label] of BASE_OPTIONS) {
    await db
      .insert(optionSets)
      .values({ kind, value, label, sortOrder: i++ })
      .onConflictDoNothing();
  }

  console.log(`Baseline seed applied. Admin sign-in is ${ADMIN_EMAIL}.`);
}
