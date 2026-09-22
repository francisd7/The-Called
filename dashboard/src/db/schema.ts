import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Only genuinely fixed vocabularies are pg enums. Everything a setter or admin
// might want to reword later (stages, sources, openers, ...) lives in
// option_sets so changing it is a row edit in the app, not a migration + deploy.
export const userRole = pgEnum('user_role', ['admin', 'setter', 'closer']);
export const confirmationMethod = pgEnum('confirmation_method', ['dm', 'phone']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('setter'),
  // Lets the dashboard @-mention a real person when it posts into Discord.
  discordId: text('discord_id'),
  // Which badge colour this person's name wears wherever it appears, so a
  // setter is recognisable at a glance rather than read every time.
  color: text('color'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// The editable dropdowns. `kind` groups them: 'conversation_stage',
// 'lead_source', 'opener', 'lead_quality', 'cancel_reason', 'lost_reason'.
export const optionSets = pgTable(
  'option_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('option_sets_kind_value_idx').on(t.kind, t.value)]
);

// The three Calendly links a setter can send. They distinguish *offers*, not
// closers - all three sit on Nigel's Calendly, and who actually hosts the call
// comes back on the booking itself (event_memberships), so it isn't mapped here.
export const offers = pgTable('offers', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  schedulingUrl: text('scheduling_url').notNull(),
  // Filled in once the Calendly API is reachable; how a booking is traced back
  // to the offer it came from.
  eventTypeUri: text('event_type_uri'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // --- identity ---
    // As typed, for display. Some existing rows hold a person's name or two
    // handles in one cell, so this is never assumed to be a valid handle.
    igHandle: text('ig_handle').notNull(),
    // Normalized for matching: lowercased, @ and profile-URL wrapper stripped.
    igHandleKey: text('ig_handle_key'),
    name: text('name'),
    email: text('email'),
    // Triage is a phone call, so this is load-bearing, not optional metadata.
    phone: text('phone'),

    // --- ownership + classification ---
    setterId: uuid('setter_id').references(() => users.id),
    leadSource: text('lead_source'),
    opener: text('opener'),
    conversationStage: text('conversation_stage'),
    leadQuality: text('lead_quality'),
    icp: text('icp'),

    // --- outreach activity ---
    outboundDm: boolean('outbound_dm').notNull().default(false),
    responded: boolean('responded').notNull().default(false),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    followUps: integer('follow_ups').notNull().default(0),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),

    // --- booking: written by the Calendly webhook, read-only in the UI ---
    offerId: uuid('offer_id').references(() => offers.id),
    callBooked: boolean('call_booked').notNull().default(false),
    // When they hit "confirm" in Calendly.
    callBookedAt: timestamp('call_booked_at', { withTimezone: true }),
    // When the call actually happens. Airtable conflated these two into one
    // "Call Booked Date" field; keeping them apart is what makes a "calls today"
    // view possible at all.
    callScheduledFor: timestamp('call_scheduled_for', { withTimezone: true }),
    // Resolved from the booking's Calendly host, matched to a user row by email.
    closerId: uuid('closer_id').references(() => users.id),
    closerName: text('closer_name'),
    calendlyEventUri: text('calendly_event_uri'),
    // Which Calendly link they booked on. The offer row only exists for the
    // handful of links live today, and most of the history sits on retired
    // ones - so without this a lead reads "Offer unknown" while the dashboard
    // has the link's name sitting in calendly_event_types all along.
    calendlyEventTypeUri: text('calendly_event_type_uri'),
    calendlyInviteeUri: text('calendly_invitee_uri'),
    // What they typed into the booking form. Kept on the lead rather than left
    // in the raw webhook log so a setter can read it before the call.
    calendlyAnswers: jsonb('calendly_answers'),
    calendlyCancelUrl: text('calendly_cancel_url'),
    calendlyRescheduleUrl: text('calendly_reschedule_url'),
    callCancelled: boolean('call_cancelled').notNull().default(false),
    callCancelledAt: timestamp('call_cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    showed: boolean('showed'),

    // --- setter workflow ---
    confirmed: boolean('confirmed').notNull().default(false),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedById: uuid('confirmed_by_id').references(() => users.id),
    confirmationMethod: confirmationMethod('confirmation_method'),

    triaged: boolean('triaged').notNull().default(false),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    triagedById: uuid('triaged_by_id').references(() => users.id),
    // Deliberately its own column rather than a note: this is the qualification
    // handoff the closer opens right before the call.
    triageNotes: text('triage_notes'),

    // Which post/reel the lead came off, where that was recorded.
    sourceContent: text('source_content'),

    // --- outcome, recorded after the call ---
    // Mirrors the fields the Airtable Post Call table carried, so nothing is
    // lost by recording it here instead - and here the lead is already known,
    // where Post Call only had a freeform first name that could never be
    // matched back to an Instagram handle.
    callOutcome: text('call_outcome'),
    tier: text('tier'),
    paymentMethod: text('payment_method'),
    fathomUrl: text('fathom_url'),
    outcomeLoggedAt: timestamp('outcome_logged_at', { withTimezone: true }),
    outcomeLoggedById: uuid('outcome_logged_by_id').references(() => users.id),

    qualified: boolean('qualified'),
    closed: boolean('closed'),
    closedDate: timestamp('closed_date', { withTimezone: true }),
    cashCollected: numeric('cash_collected', { precision: 12, scale: 2 }),
    contractValue: numeric('contract_value', { precision: 12, scale: 2 }),
    lostReason: text('lost_reason'),
    postCallNotes: text('post_call_notes'),

    leadCreatedAt: timestamp('lead_created_at', { withTimezone: true }).notNull().defaultNow(),
    // When a setter last pressed "message sent" on this conversation. Separate
    // from lastContactAt, which any edit moves - this one only moves when
    // somebody actually reached out, which is what follow-up timing needs.
    lastOutreachAt: timestamp('last_outreach_at', { withTimezone: true }),
    // Whether this conversation is live. A manual flag, not derived from the
    // stage: setters know when a thread has actually gone quiet, and a stage
    // that hasn't been updated in a fortnight doesn't.
    isActiveConvo: boolean('is_active_convo').notNull().default(false),
    // Marks a lead created by the "test booking" button. Test leads never post
    // to Discord, are labelled everywhere they appear, and can be cleared out
    // in one click - so the flow can be rehearsed without anyone being pinged
    // about a call that isn't real.
    isTest: boolean('is_test').notNull().default(false),
    // Set only for rows imported from Airtable, so re-running the import
    // updates those rows instead of creating a second copy of each.
    airtableRecordId: text('airtable_record_id').unique(),
    // Separate from airtableRecordId, which points at the lead tracker row.
    // A lead can have both: one from the tracker, one from Post Call.
    postCallRecordId: text('post_call_record_id').unique(),
    // True for a lead created from a Post Call record, which carries a person's
    // name but no Instagram handle. Flags it for someone to fill in rather than
    // leaving a made-up handle looking real.
    needsHandle: boolean('needs_handle').notNull().default(false),
    // Every Airtable field with no column of its own lands here verbatim
    // (e.g. Analytics Stage, which duplicated Conversation Stage). Nothing is
    // surfaced from it, but nothing is lost either, and a field can be promoted
    // to a real column later without re-running the migration.
    legacy: jsonb('legacy'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('leads_ig_handle_key_idx').on(t.igHandleKey),
    index('leads_active_convo_idx').on(t.isActiveConvo, t.setterId),
    index('leads_email_idx').on(t.email),
    index('leads_setter_idx').on(t.setterId),
    index('leads_stage_idx').on(t.conversationStage),
    index('leads_scheduled_idx').on(t.callScheduledFor),
    index('leads_next_follow_up_idx').on(t.nextFollowUpAt),
  ]
);

// Replaces Airtable's single "Notes" blob: authored and timestamped, so a
// thread of context builds up instead of one box people overwrite.
export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_notes_lead_idx').on(t.leadId, t.createdAt)]
);

// Audit trail. Every stage change, confirm, triage and booking lands here, which
// is what later makes "what did Loui actually do Tuesday" answerable.
export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id),
    type: text('type').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_events_lead_idx').on(t.leadId, t.createdAt)]
);

// Raw webhook log. Keeps unmatched bookings recoverable instead of dropped, and
// makes a bad deploy replayable rather than a hole in the data.
export const calendlyWebhookEvents = pgTable(
  'calendly_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: text('event_type').notNull(),
    calendlyInviteeUri: text('calendly_invitee_uri'),
    payload: jsonb('payload').notNull(),
    matchedLeadId: uuid('matched_lead_id').references(() => leads.id),
    matchStrategy: text('match_strategy'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('calendly_events_unmatched_idx').on(t.matchedLeadId, t.createdAt)]
);

// Stays a hand-filled form, per your call — not derived from lead rows.
export const eodReports = pgTable(
  'eod_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reportDate: text('report_date').notNull(), // YYYY-MM-DD in ET
    totalOutbounds: integer('total_outbounds'),
    totalFollowUps: integer('total_follow_ups'),
    totalLeadsWithReplies: integer('total_leads_with_replies'),
    youtubeVideosSent: integer('youtube_videos_sent'),
    callsPitched: integer('calls_pitched'),
    callsBooked: integer('calls_booked'),
    cashCollected: numeric('cash_collected', { precision: 12, scale: 2 }),
    revenueGenerated: numeric('revenue_generated', { precision: 12, scale: 2 }),
    win: text('win'),
    obstacle: text('obstacle'),
    focusTomorrow: text('focus_tomorrow'),
    notes: text('notes'),
    // Set only for rows brought over from the Airtable form, so re-running the
    // import updates those rather than making a second copy of each.
    airtableRecordId: text('airtable_record_id').unique(),
    // Airtable asked "Did I update the lead tracker?", which the dashboard can
    // now answer for itself. Kept verbatim rather than dropped.
    legacy: jsonb('legacy'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('eod_user_date_idx').on(t.userId, t.reportDate)]
);

/**
 * Shared and personal task lists. `ownerId` null means the team list, which
 * anyone signed in can add to.
 */
export const todos = pgTable(
  'todos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: text('due_date'), // YYYY-MM-DD in ET; a day, not a moment
    // Lets "follow up with @handle" click through to the actual lead.
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedById: uuid('completed_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('todos_owner_idx').on(t.ownerId, t.completedAt), index('todos_due_idx').on(t.dueDate)]
);

/**
 * One focus per person per week, plus a team one (ownerId null). Keyed on the
 * week so last week's focus stays readable instead of being overwritten.
 */
export const focuses = pgTable(
  'focuses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    weekOf: text('week_of').notNull(), // the Monday, YYYY-MM-DD in ET
    body: text('body').notNull(),
    updatedById: uuid('updated_by_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // A unique CONSTRAINT rather than a unique index, because only the
  // constraint builder exposes nullsNotDistinct - and that is the whole point
  // here. The team focus has owner_id NULL, and Postgres counts NULLs as
  // distinct by default, so without it "one focus per owner per week" silently
  // wouldn't hold for the team row and every save would insert another copy.
  (t) => [unique('focus_owner_week_key').on(t.ownerId, t.weekOf).nullsNotDistinct()]
);

export const issueKind = pgEnum('issue_kind', ['report', 'error']);
export const issueStatus = pgEnum('issue_status', ['open', 'resolved']);

/**
 * Problems worth an admin's attention: something a setter reported by hand, or
 * something the app itself failed at. Both land here so there's one place to
 * look rather than a deploy log nobody reads.
 */
export const appIssues = pgTable(
  'app_issues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: issueKind('kind').notNull(),
    title: text('title').notNull(),
    detail: text('detail'),
    // Where it happened, and anything that helps reproduce it.
    context: jsonb('context'),
    // What to do about it, written at the point of failure where the cause is
    // actually known - an error message alone rarely says what to try.
    remedy: text('remedy'),
    reportedById: uuid('reported_by_id').references(() => users.id),
    status: issueStatus('status').notNull().default('open'),
    // Repeats of the same failure bump this rather than filling the list.
    seenCount: integer('seen_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_issues_open_idx').on(t.status, t.lastSeenAt)]
);

export const postCallReportStatus = pgEnum('post_call_report_status', [
  'pending',
  'linked',
  'ignored',
]);

/**
 * A closer's post-call form, as filled in, before anyone has said who it was
 * about.
 *
 * The form asks for a first name and nothing that identifies the lead, so a
 * report cannot be matched to a conversation automatically - and guessing from
 * a name across 500 leads gets it wrong often enough to be worse than useless.
 * So reports land here on their own, wait in plain sight, and a person spends
 * the five seconds it takes to point each one at the right lead.
 *
 * The invariant this buys: nothing pending means the numbers are complete.
 * That is the whole reason the reports aren't written straight onto leads.
 */
export const postCallReports = pgTable(
  'post_call_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The Airtable row behind this. Sync upserts on it, so re-running never
    // produces a second copy of the same call.
    airtableRecordId: text('airtable_record_id').notNull().unique(),

    // --- the form, as submitted ---
    leadName: text('lead_name').notNull(),
    callDate: timestamp('call_date', { withTimezone: true }),
    closerName: text('closer_name'),
    setterName: text('setter_name'),
    outcome: text('outcome'),
    tier: text('tier'),
    paymentMethod: text('payment_method'),
    cashCollected: numeric('cash_collected', { precision: 12, scale: 2 }),
    contractValue: numeric('contract_value', { precision: 12, scale: 2 }),
    notes: text('notes'),
    fathomUrl: text('fathom_url'),

    // --- what's been done about it ---
    status: postCallReportStatus('status').notNull().default('pending'),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    // Whether the lead above was created from this report rather than matched to
    // one that already existed. That's what makes it safe to remove the lead
    // again if the report is later pointed at the real conversation.
    leadWasCreated: boolean('lead_was_created').notNull().default(false),
    linkedById: uuid('linked_by_id').references(() => users.id),
    linkedAt: timestamp('linked_at', { withTimezone: true }),

    // The form's answers as last seen in Airtable, joined into one string. A
    // change here means a closer edited their submission, which is the only
    // reason to push an already-linked report onto its lead a second time.
    fingerprint: text('fingerprint'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('post_call_reports_status_idx').on(t.status, t.callDate)]
);

/**
 * Every Calendly link the account has ever taken a booking on, and whether its
 * bookings are sales calls.
 *
 * A webhook is registered against the whole organization and the
 * scheduled-events API returns the whole organization, so something has to say
 * which links count. The three current offers are not enough: most of the
 * history is on links that have since been retired, and one live link is
 * Nigel's coaching calls with existing clients, which are not leads at all.
 *
 * Discovered from the bookings themselves rather than from Calendly's event
 * type list, so a link that was deleted still shows up as long as somebody
 * once booked on it.
 */
export const calendlyEventTypes = pgTable('calendly_event_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  uri: text('uri').notNull().unique(),
  name: text('name').notNull(),
  /** How many bookings were seen on it the last time we looked. */
  bookingCount: integer('booking_count').notNull().default(0),
  /** Whether a booking here is a sales call. Set by an admin, never guessed. */
  counted: boolean('counted').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A lead that was merged into another, kept as a tombstone after the row itself
 * is gone.
 *
 * Without this a merge undoes itself. The tracker holds 22 handles twice, each
 * copy its own Airtable row with its own record id; merging deletes one of
 * them, and the next import finds that record id attached to nothing and
 * creates the duplicate all over again. So the record id outlives the row, and
 * the import follows it to whichever lead survived.
 *
 * Deliberately not `onDelete: 'cascade'` on keptLeadId: if the surviving lead
 * is ever deleted the tombstone has to stay, or the record id comes back as a
 * new lead again.
 */
export const leadMerges = pgTable(
  'lead_merges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The row that was removed. Kept for the audit trail; nothing points at it. */
    mergedLeadId: uuid('merged_lead_id').notNull(),
    /** Its Airtable record id, if it had one. This is what the import follows. */
    mergedAirtableRecordId: text('merged_airtable_record_id').unique(),
    /** Its handle at the time, so the log reads as something other than two uuids. */
    mergedIgHandle: text('merged_ig_handle'),
    keptLeadId: uuid('kept_lead_id').notNull(),
    mergedById: uuid('merged_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_merges_kept_idx').on(t.keptLeadId)]
);

/**
 * A pair of leads somebody has looked at and said are two different people.
 *
 * Stored as a pair rather than per handle, so a third row landing on the same
 * handle later still gets asked about instead of hiding behind an answer given
 * about the other two. Ids are stored in a fixed order so a pair can only be
 * dismissed once, whichever way round it was seen.
 */
export const leadNotDuplicates = pgTable(
  'lead_not_duplicates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadAId: uuid('lead_a_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    leadBId: uuid('lead_b_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    dismissedById: uuid('dismissed_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('lead_not_duplicates_pair').on(t.leadAId, t.leadBId)]
);
