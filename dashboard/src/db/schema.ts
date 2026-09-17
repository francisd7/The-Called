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

// The three Calendly links setters send. Each row knows its scheduling URL, so
// the dashboard can hand back a per-lead tracked version of it.
export const bookingLinks = pgTable('booking_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(),
  closerId: uuid('closer_id').references(() => users.id),
  schedulingUrl: text('scheduling_url').notNull(),
  eventTypeUri: text('event_type_uri'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // --- identity ---
    igHandle: text('ig_handle').notNull(),
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
    bookingLinkId: uuid('booking_link_id').references(() => bookingLinks.id),
    callBooked: boolean('call_booked').notNull().default(false),
    // When they hit "confirm" in Calendly.
    callBookedAt: timestamp('call_booked_at', { withTimezone: true }),
    // When the call actually happens. Airtable conflated these two into one
    // "Call Booked Date" field; keeping them apart is what makes a "calls today"
    // view possible at all.
    callScheduledFor: timestamp('call_scheduled_for', { withTimezone: true }),
    closerId: uuid('closer_id').references(() => users.id),
    calendlyEventUri: text('calendly_event_uri'),
    calendlyInviteeUri: text('calendly_invitee_uri'),
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

    leadCreatedAt: timestamp('lead_created_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_ig_handle_idx').on(t.igHandle),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('eod_user_date_idx').on(t.userId, t.reportDate)]
);
