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
/**
 * What the Dashboard shows under "needs chasing".
 *
 * Measured by silence since somebody last reached out - the same rule the
 * Follow Ups page uses. It previously keyed off a manually-set "next follow-up"
 * date, which almost no lead has, so the two screens disagreed about who was
 * overdue and the Dashboard list was near-empty by construction.
 */
export async function getDueFollowUps(setterId?: string, limit = 12) {
  const silence = sql`COALESCE(${leads.lastOutreachAt}, ${leads.lastContactAt}, ${leads.leadCreatedAt})`;
  const filters = [
    eq(leads.isActiveConvo, true),
    eq(leads.isTest, false),
    // A booked call isn't waiting on a follow-up; it's waiting on the call.
    or(eq(leads.callBooked, false), eq(leads.callCancelled, true)),
    sql`${silence} <= NOW() - INTERVAL '7 days'`,
  ];
  if (setterId) filters.push(eq(leads.setterId, setterId));
  const clause = and(...filters);

  // Only the quietest are shown here; the Follow Ups page is where the whole
  // backlog is worked through.
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(leads).where(clause).orderBy(asc(silence)).limit(limit),
    db.select({ total: count() }).from(leads).where(clause),
  ]);

  return { rows, total };
}

export type LeadFilters = {
  q?: string;
  setterId?: string;
  stage?: string;
  quality?: string;
  source?: string;
  booked?: boolean;
  /** 'active' | 'inactive' | undefined for either */
  activity?: string;
  page?: number;
  perPage?: number;
};

const DEFAULT_PAGE_SIZE = 50;

export async function searchLeads(filters: LeadFilters) {
  const where = [];
  if (filters.q) {
    const term = `%${filters.q}%`;
    where.push(
      or(ilike(leads.igHandle, term), ilike(leads.name, term), ilike(leads.email, term))
    );
  }
  if (filters.setterId) {
    // A named setter, or explicitly nobody.
    where.push(
      filters.setterId === 'none' ? isNull(leads.setterId) : eq(leads.setterId, filters.setterId)
    );
  }
  if (filters.stage) where.push(eq(leads.conversationStage, filters.stage));
  if (filters.quality) where.push(eq(leads.leadQuality, filters.quality));
  if (filters.source) where.push(eq(leads.leadSource, filters.source));
  if (filters.booked) where.push(liveCall);
  if (filters.activity === 'active') where.push(eq(leads.isActiveConvo, true));
  if (filters.activity === 'inactive') where.push(eq(leads.isActiveConvo, false));

  const clause = where.length > 0 ? and(...where) : undefined;
  const page = Math.max(1, filters.page ?? 1);
  // Clamped so a hand-edited URL can't ask for every row at once.
  const pageSize = Math.min(500, Math.max(10, filters.perPage ?? DEFAULT_PAGE_SIZE));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(clause)
      .orderBy(desc(leads.lastContactAt), desc(leads.leadCreatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(leads).where(clause),
  ]);

  return { rows, total, page, pageSize, pages: Math.ceil(total / pageSize) };
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

export type Period = 'today' | 'week' | 'month';

/** The window a period covers, anchored to the team's calendar. */
function periodStart(period: Period): Date {
  const { start } = teamDayRange(0);
  if (period === 'today') return start;
  if (period === 'week') {
    // Back to Monday, not a rolling seven days - "this week" means the week.
    const d = new Date(`${weekStart()}T12:00:00Z`);
    return new Date(Math.min(d.getTime(), start.getTime()));
  }
  const d = new Date(start);
  d.setUTCDate(1);
  return d;
}

export async function getPeriodSummary(period: Period) {
  const from = periodStart(period);
  const scope = [eq(leads.isTest, false), gte(leads.callBookedAt, from)];

  const [[booked], [closedRow], [newLeads]] = await Promise.all([
    db.select({ n: count() }).from(leads).where(and(...scope)),
    db
      .select({
        cash: sql<string>`COALESCE(SUM(${leads.cashCollected}), 0)`,
        contract: sql<string>`COALESCE(SUM(${leads.contractValue}), 0)`,
        deals: sql<number>`COUNT(*) FILTER (WHERE ${leads.closed})::int`,
      })
      .from(leads)
      .where(and(eq(leads.isTest, false), gte(leads.closedDate, from))),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.isTest, false), gte(leads.leadCreatedAt, from))),
  ]);

  return {
    booked: booked.n,
    newLeads: newLeads.n,
    deals: closedRow.deals,
    cash: Number(closedRow.cash),
    contract: Number(closedRow.contract),
  };
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
    setterColors: new Map(people.map((p) => [p.id, p.color])),
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

/**
 * Active conversations grouped by who owns them, plus the totals for the board
 * at the top. Unassigned is kept as its own group rather than hidden: most of
 * the imported backlog has no setter on it, and a view that only showed named
 * columns would quietly lose hundreds of live conversations.
 */
export async function getActiveConvos(perGroup = 25) {
  const [setters, rows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(eq(users.active, true), eq(users.role, 'setter')))
      .orderBy(asc(users.createdAt)),
    db
      .select()
      .from(leads)
      .where(and(eq(leads.isActiveConvo, true), eq(leads.isTest, false)))
      .orderBy(desc(leads.lastContactAt), desc(leads.leadCreatedAt)),
  ]);

  const groups = setters.map((s) => {
    const owned = rows.filter((r) => r.setterId === s.id);
    return { id: s.id, name: s.name, total: owned.length, leads: owned.slice(0, perGroup) };
  });
  const unassigned = rows.filter((r) => !r.setterId);

  return {
    groups,
    unassigned: { total: unassigned.length, leads: unassigned.slice(0, perGroup) },
    teamTotal: rows.length,
  };
}

/** Money on the leads themselves, which is where the dashboard tiles read from. */
export async function getMoneyTotals() {
  const [[all], perSetter] = await Promise.all([
    db
      .select({
        cash: sql<string>`COALESCE(SUM(${leads.cashCollected}), 0)`,
        contract: sql<string>`COALESCE(SUM(${leads.contractValue}), 0)`,
        closed: count(leads.closed),
      })
      .from(leads)
      .where(eq(leads.isTest, false)),
    db
      .select({
        setterId: leads.setterId,
        cash: sql<string>`COALESCE(SUM(${leads.cashCollected}), 0)`,
        contract: sql<string>`COALESCE(SUM(${leads.contractValue}), 0)`,
      })
      .from(leads)
      .where(and(eq(leads.isTest, false), isNotNull(leads.setterId)))
      .groupBy(leads.setterId),
  ]);

  return {
    cash: Number(all.cash),
    contract: Number(all.contract),
    perSetter: perSetter.map((r) => ({
      setterId: r.setterId,
      cash: Number(r.cash),
      contract: Number(r.contract),
    })),
  };
}

/**
 * How long a conversation has been silent, measured from the last time somebody
 * actually reached out - falling back to last contact and then to when the lead
 * was created, because a lead nobody has ever messaged is the most overdue of
 * all, not the least.
 *
 * Bands are exclusive ranges rather than cumulative: "1 week" means between a
 * week and a month. Cumulative bands put almost every lead in the first tab,
 * which is a pile rather than a list to work through.
 */
export const FOLLOW_UP_BUCKETS = [
  { key: '1w', label: '1 week', from: 7, to: 30 },
  { key: '1m', label: '1 month', from: 30, to: 90 },
  { key: '3m', label: '3 months', from: 90, to: 180 },
  { key: '6m', label: '6 months', from: 180, to: 365 },
  { key: '1y', label: '1 year+', from: 365, to: null },
] as const;

export type FollowUpBucket = (typeof FOLLOW_UP_BUCKETS)[number]['key'];

const silenceExpr = sql`COALESCE(${leads.lastOutreachAt}, ${leads.lastContactAt}, ${leads.leadCreatedAt})`;

function followUpBase(setterId?: string) {
  const filters = [
    eq(leads.isActiveConvo, true),
    eq(leads.isTest, false),
    // A booked call isn't waiting on a follow-up; it's waiting on the call.
    or(eq(leads.callBooked, false), eq(leads.callCancelled, true)),
  ];
  if (setterId) {
    filters.push(setterId === 'none' ? isNull(leads.setterId) : eq(leads.setterId, setterId));
  }
  return filters;
}

export async function getFollowUps(bucket: FollowUpBucket, setterId?: string) {
  const spec = FOLLOW_UP_BUCKETS.find((b) => b.key === bucket) ?? FOLLOW_UP_BUCKETS[0];
  const filters = followUpBase(setterId);

  // Intervals rather than JS Dates: drizzle can't infer a parameter type inside
  // a raw comparison, and passing a Date fails at request time.
  filters.push(sql`${silenceExpr} <= NOW() - (${spec.from} * INTERVAL '1 day')`);
  if (spec.to !== null) {
    filters.push(sql`${silenceExpr} > NOW() - (${spec.to} * INTERVAL '1 day')`);
  }

  return db
    .select()
    .from(leads)
    .where(and(...filters))
    .orderBy(asc(silenceExpr))
    .limit(50);
}

/** How many sit in each band, for the tabs along the top. */
export async function getFollowUpCounts(setterId?: string) {
  const base = followUpBase(setterId);
  const band = (from: number, to: number | null) =>
    to === null
      ? sql<number>`COUNT(*) FILTER (WHERE ${silenceExpr} <= NOW() - (${from} * INTERVAL '1 day'))::int`
      : sql<number>`COUNT(*) FILTER (WHERE ${silenceExpr} <= NOW() - (${from} * INTERVAL '1 day') AND ${silenceExpr} > NOW() - (${to} * INTERVAL '1 day'))::int`;

  const [row] = await db
    .select({ w1: band(7, 30), m1: band(30, 90), m3: band(90, 180), m6: band(180, 365), y1: band(365, null) })
    .from(leads)
    .where(and(...base));

  return { '1w': row.w1, '1m': row.m1, '3m': row.m3, '6m': row.m6, '1y': row.y1 } as Record<
    FollowUpBucket,
    number
  >;
}

/**
 * Calls whose time has passed with no outcome recorded. Without somewhere to
 * see these, "log the outcome" is a habit that quietly stops and the funnel's
 * bottom half goes stale without anyone noticing.
 */
export async function getCallsAwaitingOutcome(limit = 20) {
  const clause = and(
    eq(leads.isTest, false),
    eq(leads.callBooked, true),
    eq(leads.callCancelled, false),
    isNull(leads.outcomeLoggedAt),
    isNotNull(leads.callScheduledFor),
    // An hour's grace, so a call still in progress isn't already nagging.
    sql`${leads.callScheduledFor} < NOW() - INTERVAL '1 hour'`
  );

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(leads).where(clause).orderBy(desc(leads.callScheduledFor)).limit(limit),
    db.select({ total: count() }).from(leads).where(clause),
  ]);
  return { rows, total };
}
