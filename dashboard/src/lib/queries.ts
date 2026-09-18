import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  calendlyWebhookEvents,
  focuses,
  leadNotes,
  leads,
  offers,
  optionSets,
  todos,
  users,
} from '@/db/schema';
import { teamDayRange, weekStart } from './dates';

export type LeadRow = typeof leads.$inferSelect;

const liveCall = and(eq(leads.callBooked, true), eq(leads.callCancelled, false));

/** Calls happening today, soonest first - the first thing a setter should see. */
export async function getTodaysCalls() {
  const { start, end } = teamDayRange(0);
  return db
    .select()
    .from(leads)
    .where(and(liveCall, gte(leads.callScheduledFor, start), lt(leads.callScheduledFor, end)))
    .orderBy(asc(leads.callScheduledFor));
}

/** The next week of calls, excluding today. */
export async function getUpcomingCalls() {
  const { end } = teamDayRange(0);
  const horizon = new Date(end.getTime() + 7 * 86_400_000);
  return db
    .select()
    .from(leads)
    .where(and(liveCall, gte(leads.callScheduledFor, end), lt(leads.callScheduledFor, horizon)))
    .orderBy(asc(leads.callScheduledFor));
}

/**
 * Follow-ups that are due or overdue. Anything with a live call is excluded -
 * that lead is already in the calls list and doesn't need chasing twice.
 */
export async function getDueFollowUps(setterId?: string, limit = 8) {
  const { end } = teamDayRange(0);
  const filters = [
    isNotNull(leads.nextFollowUpAt),
    lt(leads.nextFollowUpAt, end),
    or(eq(leads.callBooked, false), eq(leads.callCancelled, true)),
  ];
  if (setterId) filters.push(eq(leads.setterId, setterId));
  const clause = and(...filters);

  // Only the most overdue are shown on Today. The imported backlog runs to
  // dozens, and a list that long pushes everything under it off the screen -
  // the count plus a link is more useful than the whole pile.
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(leads).where(clause).orderBy(asc(leads.nextFollowUpAt)).limit(limit),
    db.select({ total: count() }).from(leads).where(clause),
  ]);

  return { rows, total };
}

/** Booked calls with work still outstanding on them. */
export async function getWorkQueue() {
  const { start } = teamDayRange(0);
  const rows = await db
    .select()
    .from(leads)
    .where(and(liveCall, gte(leads.callScheduledFor, start)))
    .orderBy(asc(leads.callScheduledFor));

  return {
    needsConfirming: rows.filter((r) => !r.confirmed),
    needsTriage: rows.filter((r) => !r.triaged),
  };
}

export type LeadFilters = {
  q?: string;
  setterId?: string;
  stage?: string;
  booked?: boolean;
  page?: number;
};

const PAGE_SIZE = 50;

export async function searchLeads(filters: LeadFilters) {
  const where = [];
  if (filters.q) {
    const term = `%${filters.q}%`;
    where.push(
      or(ilike(leads.igHandle, term), ilike(leads.name, term), ilike(leads.email, term))
    );
  }
  if (filters.setterId) where.push(eq(leads.setterId, filters.setterId));
  if (filters.stage) where.push(eq(leads.conversationStage, filters.stage));
  if (filters.booked) where.push(liveCall);

  const clause = where.length > 0 ? and(...where) : undefined;
  const page = Math.max(1, filters.page ?? 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(clause)
      .orderBy(desc(leads.lastContactAt), desc(leads.leadCreatedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(leads).where(clause),
  ]);

  return { rows, total, page, pageSize: PAGE_SIZE, pages: Math.ceil(total / PAGE_SIZE) };
}

export async function getLead(id: string) {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) return null;

  const [notes, setter, closer, offer] = await Promise.all([
    db.select().from(leadNotes).where(eq(leadNotes.leadId, id)).orderBy(desc(leadNotes.createdAt)),
    lead.setterId ? db.query.users.findFirst({ where: eq(users.id, lead.setterId) }) : null,
    lead.closerId ? db.query.users.findFirst({ where: eq(users.id, lead.closerId) }) : null,
    lead.offerId ? db.query.offers.findFirst({ where: eq(offers.id, lead.offerId) }) : null,
  ]);

  const authorIds = [...new Set(notes.map((n) => n.authorId).filter(Boolean))] as string[];
  const authors = authorIds.length > 0 ? await db.select().from(users) : [];
  const authorById = new Map(authors.map((a) => [a.id, a.name]));

  return {
    lead,
    setter,
    closer,
    offer,
    notes: notes.map((n) => ({
      ...n,
      authorName: n.authorId ? (authorById.get(n.authorId) ?? 'Unknown') : 'Airtable import',
    })),
  };
}

export async function getOptions(kind: string) {
  return db
    .select()
    .from(optionSets)
    .where(and(eq(optionSets.kind, kind), eq(optionSets.active, true)))
    .orderBy(asc(optionSets.sortOrder), asc(optionSets.label));
}

export async function getActiveOffers() {
  return db
    .select()
    .from(offers)
    .where(eq(offers.active, true))
    .orderBy(asc(offers.sortOrder));
}

export async function getSetters() {
  return db
    .select()
    .from(users)
    .where(and(eq(users.active, true)))
    .orderBy(asc(users.name));
}

/** Bookings that matched no lead - someone has to reconcile these by hand. */
export async function getUnmatchedBookings() {
  return db
    .select()
    .from(calendlyWebhookEvents)
    .where(
      and(
        eq(calendlyWebhookEvents.eventType, 'invitee.created'),
        sql`${calendlyWebhookEvents.matchedLeadId} IS NULL`
      )
    )
    .orderBy(desc(calendlyWebhookEvents.createdAt))
    .limit(50);
}

/**
 * Counts for one setter's day. Reported alongside the EOD form as a reference
 * point, not prefilled into it - not every outbound DM becomes a lead row, so
 * these would understate the real numbers.
 */
export async function getDayStats(setterId: string, dayOffset = 0) {
  const { start, end } = teamDayRange(dayOffset);
  const inDay = (col: PgColumn) => and(gte(col, start), lt(col, end));

  const [[newLeads], [replies], [booked]] = await Promise.all([
    db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.setterId, setterId), inDay(leads.leadCreatedAt))),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.setterId, setterId), inDay(leads.respondedAt))),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.setterId, setterId), inDay(leads.callBookedAt))),
  ]);

  return { newLeads: newLeads.n, replies: replies.n, booked: booked.n };
}

export async function getPipelineSummary() {
  const { start, end } = teamDayRange(0);
  const [[total], [bookedLive], [todayCalls], [unconfirmed], [untriaged]] = await Promise.all([
    db.select({ n: count() }).from(leads),
    db.select({ n: count() }).from(leads).where(liveCall),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(liveCall, gte(leads.callScheduledFor, start), lt(leads.callScheduledFor, end))),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(liveCall, gte(leads.callScheduledFor, start), eq(leads.confirmed, false))),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(liveCall, gte(leads.callScheduledFor, start), eq(leads.triaged, false))),
  ]);

  return {
    totalLeads: total.n,
    bookedCalls: bookedLive.n,
    todayCalls: todayCalls.n,
    needsConfirming: unconfirmed.n,
    needsTriage: untriaged.n,
  };
}

/**
 * The name and label maps the lead cards need, fetched once per page rather
 * than once per card.
 */
export async function getLeadCardLookups() {
  const [people, stages, qualities] = await Promise.all([
    db.select().from(users),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
  ]);
  return {
    setterNames: new Map(people.map((p) => [p.id, p.name])),
    stageLabels: new Map(stages.map((s) => [s.value, s.label])),
    qualityLabels: new Map(qualities.map((s) => [s.value, s.label])),
  };
}

/** People who can be picked as the closer on a call. */
export async function getClosers() {
  return db
    .select()
    .from(users)
    .where(eq(users.role, 'closer'))
    .orderBy(asc(users.name));
}

/** Setters and admins - anyone who can own a lead. */
export async function getAssignableSetters() {
  return db
    .select()
    .from(users)
    .where(and(eq(users.active, true), ne(users.role, 'closer')))
    .orderBy(asc(users.name));
}

export type TodoRow = typeof todos.$inferSelect & {
  leadHandle: string | null;
  ownerName: string | null;
};

async function todosWhere(clause: ReturnType<typeof eq> | undefined): Promise<TodoRow[]> {
  const rows = await db
    .select({
      todo: todos,
      leadHandle: leads.igHandle,
      ownerName: users.name,
    })
    .from(todos)
    .leftJoin(leads, eq(todos.leadId, leads.id))
    .leftJoin(users, eq(todos.ownerId, users.id))
    .where(clause)
    // Open items first, then soonest due. A list that buries what's due under
    // what's finished stops getting read.
    .orderBy(asc(todos.completedAt), asc(todos.dueDate), desc(todos.createdAt));

  return rows.map((r) => ({ ...r.todo, leadHandle: r.leadHandle, ownerName: r.ownerName }));
}

/**
 * Everything the week-planning row needs, in one pass: a column per setter plus
 * a team column, each with its focus and its list. Fetched together rather than
 * per column so adding a third setter doesn't add three more round trips.
 */
export async function getWeekBoard() {
  const week = weekStart();
  const [people, allTodos, allFocuses] = await Promise.all([
    // Setters only. Giving admins a column too meant four panels where three
    // were asked for, and pushed the shared team column off centre. An admin
    // can still edit any column and use the team list.
    db
      .select()
      .from(users)
      .where(and(eq(users.active, true), eq(users.role, 'setter')))
      // Insertion order, not alphabetical, so the columns keep the order the
      // team was set up in rather than reshuffling when someone is renamed.
      .orderBy(asc(users.createdAt)),
    todosWhere(undefined),
    db.select().from(focuses).where(eq(focuses.weekOf, week)),
  ]);

  const byOwner = (ownerId: string | null) => ({
    focus: allFocuses.find((f) => f.ownerId === ownerId) ?? null,
    todos: allTodos.filter((t) => t.ownerId === ownerId),
  });

  return {
    week,
    team: { id: null, name: 'Team', ...byOwner(null) },
    people: people.map((p) => ({ id: p.id, name: p.name, ...byOwner(p.id) })),
  };
}

/**
 * The last few Calendly deliveries, whatever happened to them. This is the
 * answer to "is the webhook actually working" - a registered webhook that never
 * delivers looks exactly like nobody booking.
 */
export async function getRecentCalendlyActivity(limit = 20) {
  return db
    .select()
    .from(calendlyWebhookEvents)
    .orderBy(desc(calendlyWebhookEvents.createdAt))
    .limit(limit);
}
