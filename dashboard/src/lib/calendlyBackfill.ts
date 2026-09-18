/**
 * Pulls every booking Calendly has ever taken, not just the ones a webhook
 * happened to deliver.
 *
 * The webhook only ever hears about bookings made after it was registered, so
 * everything before that - and every booking a setter never entered in the
 * tracker - exists only in Calendly. That includes cancellations, which no
 * other source has at all past 25 August.
 *
 * A booking with no lead behind it gets one created. These are exactly the
 * conversations that were never entered: refusing to create them would be
 * throwing away the record of a real call for the sake of a tidy table.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { leadEvents, leads, offers, users } from '../db/schema.ts';
import * as schema from '../db/schema.ts';
import {
  hostFromPayload,
  igHandleFromAnswers,
  leadIdFromTracking,
  phoneFromPayload,
  type CalendlyInviteePayload,
} from './calendly.ts';

type Db = PostgresJsDatabase<typeof schema>;

const API = process.env.CALENDLY_API_BASE ?? 'https://api.calendly.com';

type ScheduledEvent = {
  uri: string;
  status: string;
  start_time?: string;
  end_time?: string;
  event_type?: string;
  event_memberships?: Array<{ user?: string; user_email?: string; user_name?: string }>;
  cancellation?: { canceled_by?: string; reason?: string; canceler_type?: string };
};

type Invitee = {
  uri?: string;
  email?: string;
  name?: string;
  status?: string;
  cancel_url?: string;
  reschedule_url?: string;
  text_reminder_number?: string | null;
  tracking?: CalendlyInviteePayload['tracking'];
  questions_and_answers?: CalendlyInviteePayload['questions_and_answers'];
};

/** One event and its invitee, in the shape the webhook helpers already read. */
export type BackfillItem = { event: ScheduledEvent; invitee: Invitee };

export type BackfillStats = {
  events: number;
  matched: number;
  created: number;
  updated: number;
  cancelled: number;
  skipped: number;
  dryRun: boolean;
  range: { from: string; to: string } | null;
};

async function callApi<T>(pat: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('Calendly rejected the token (401). Is it correct?');
    if (res.status === 403) {
      throw new Error(
        'Calendly returned 403. This token lacks organization-admin rights — use one from the ' +
          'account that owns the booking links.'
      );
    }
    throw new Error(`Calendly GET ${path} failed (${res.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Every scheduled event since `since`, cancelled ones included, each with the
 * person who booked it.
 */
export async function fetchCalendlyHistory(pat: string, since: string): Promise<BackfillItem[]> {
  const me = await callApi<{ resource: { current_organization: string } }>(pat, '/users/me');
  const org = me.resource.current_organization;

  const events: ScheduledEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      organization: org,
      min_start_time: since,
      count: '100',
      sort: 'start_time:asc',
    });
    if (pageToken) params.set('page_token', pageToken);
    const page = await callApi<{
      collection: ScheduledEvent[];
      pagination?: { next_page_token?: string | null };
    }>(pat, `/scheduled_events?${params}`);
    events.push(...page.collection);
    pageToken = page.pagination?.next_page_token ?? undefined;
  } while (pageToken);

  const items: BackfillItem[] = [];
  for (const event of events) {
    const uuid = event.uri.split('/').pop();
    if (!uuid) continue;
    const res = await callApi<{ collection: Invitee[] }>(
      pat,
      `/scheduled_events/${uuid}/invitees?count=100`
    );
    // A one-to-one call has exactly one invitee; take the first either way.
    const invitee = res.collection[0];
    if (invitee) items.push({ event, invitee });
  }
  return items;
}

/** The shape the webhook's own helpers expect, assembled from the two calls. */
function toPayload({ event, invitee }: BackfillItem): CalendlyInviteePayload {
  return {
    uri: invitee.uri,
    email: invitee.email,
    name: invitee.name,
    status: invitee.status,
    cancel_url: invitee.cancel_url,
    reschedule_url: invitee.reschedule_url,
    text_reminder_number: invitee.text_reminder_number,
    tracking: invitee.tracking,
    questions_and_answers: invitee.questions_and_answers,
    cancellation: event.cancellation,
    scheduled_event: {
      uri: event.uri,
      start_time: event.start_time,
      end_time: event.end_time,
      event_type: event.event_type,
      event_memberships: event.event_memberships,
    },
  };
}

export async function backfillCalendly(
  db: Db,
  {
    pat,
    since,
    items,
    dryRun = false,
  }: { pat?: string; since?: string; items?: BackfillItem[]; dryRun?: boolean } = {}
): Promise<BackfillStats> {
  const from = since ?? '2026-06-01T00:00:00Z';
  const history = items ?? (await fetchCalendlyHistory(pat ?? process.env.CALENDLY_PAT ?? '', from));

  // Oldest first, so a lead that booked, cancelled and rebooked ends on its
  // most recent state rather than whichever row came back last.
  const ordered = [...history].sort((a, b) =>
    (a.event.start_time ?? '').localeCompare(b.event.start_time ?? '')
  );

  const stats: BackfillStats = {
    events: ordered.length,
    matched: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    dryRun,
    range: ordered.length
      ? {
          from: ordered[0].event.start_time?.slice(0, 10) ?? '?',
          to: ordered[ordered.length - 1].event.start_time?.slice(0, 10) ?? '?',
        }
      : null,
  };

  const offerRows = await db.select().from(offers);
  const people = await db.select().from(users);

  for (const item of ordered) {
    const payload = toPayload(item);
    const start = payload.scheduled_event?.start_time
      ? new Date(payload.scheduled_event.start_time)
      : null;
    const startTime = start && !Number.isNaN(start.getTime()) ? start : null;
    const cancelled = item.event.status === 'canceled';
    if (cancelled) stats.cancelled += 1;

    // Already carrying this exact booking? Then this is a re-run.
    const byEvent = await db.query.leads.findFirst({
      where: eq(leads.calendlyEventUri, item.event.uri),
      columns: { id: true },
    });

    let leadId = byEvent?.id ?? null;

    if (!leadId) {
      leadId = await findLead(db, payload);
      if (leadId) stats.matched += 1;
    }

    if (!leadId) {
      // Nobody entered this conversation. The call still happened.
      const handle = igHandleFromAnswers(payload);
      const name = payload.name?.trim() || null;
      if (!handle && !name && !payload.email) {
        stats.skipped += 1;
        continue;
      }
      if (dryRun) {
        stats.created += 1;
        continue;
      }
      const [row] = await db
        .insert(leads)
        .values({
          igHandle: handle ?? name ?? payload.email!,
          igHandleKey: handle ?? null,
          // No handle on the booking form means there is nothing to key on. A
          // person fills it in rather than the app inventing one.
          needsHandle: !handle,
          name,
          email: payload.email?.trim().toLowerCase() ?? null,
          responded: true,
          isActiveConvo: true,
          leadCreatedAt: startTime ?? new Date(),
        })
        .returning({ id: leads.id });
      leadId = row.id;
      stats.created += 1;
      await db.insert(leadEvents).values({
        leadId,
        type: 'created',
        meta: { source: 'calendly_backfill' } as never,
      });
    } else if (dryRun) {
      if (byEvent) stats.updated += 1;
      continue;
    } else if (byEvent) {
      stats.updated += 1;
    }

    if (dryRun) continue;

    // Read back what's there so the booking date can be preserved in JS. A JS
    // Date handed to a raw SQL template reaches the driver as an object and
    // throws at request time.
    const current = await db.query.leads.findFirst({
      where: eq(leads.id, leadId),
      columns: { callBookedAt: true },
    });

    const offer = offerRows.find((o) => o.eventTypeUri === payload.scheduled_event?.event_type);
    const host = hostFromPayload(payload);
    const closer = host.email
      ? (people.find((p) => p.email.toLowerCase() === host.email!.toLowerCase()) ?? null)
      : null;
    const phone = phoneFromPayload(payload);
    const answers =
      payload.questions_and_answers && payload.questions_and_answers.length > 0
        ? payload.questions_and_answers
        : null;

    await db
      .update(leads)
      .set({
        callBooked: true,
        callScheduledFor: startTime,
        // The moment of booking isn't on a scheduled event, so the call itself
        // stands in for it - close enough to count it in the right month.
        callBookedAt: current?.callBookedAt ?? startTime,
        // Anyone who books has replied, whatever the tracker says.
        responded: true,
        offerId: offer?.id ?? null,
        closerId: closer?.id ?? null,
        closerName: closer?.name ?? host.name,
        calendlyEventUri: item.event.uri,
        calendlyInviteeUri: payload.uri ?? null,
        calendlyAnswers: answers,
        calendlyCancelUrl: payload.cancel_url ?? null,
        calendlyRescheduleUrl: payload.reschedule_url ?? null,
        callCancelled: cancelled,
        callCancelledAt: cancelled ? (startTime ?? new Date()) : null,
        cancelReason: cancelled ? (item.event.cancellation?.reason ?? null) : null,
        // Confirmed and triaged are deliberately left alone. The live webhook
        // resets them on a rebooking because that is new work for a setter;
        // here the calls are historical, and clearing a flag somebody set by
        // hand would destroy their record of having done the work.
        ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
        ...(payload.email?.trim() ? { email: payload.email.trim().toLowerCase() } : {}),
        ...(phone ? { phone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    await db.insert(leadEvents).values({
      leadId,
      type: cancelled ? 'call_cancelled' : 'call_booked',
      toValue: startTime?.toISOString() ?? null,
      meta: { source: 'calendly_backfill', eventUri: item.event.uri } as never,
    });
  }

  return stats;
}

/** The webhook's three strategies, in the same order, against an injected db. */
async function findLead(db: Db, payload: CalendlyInviteePayload): Promise<string | null> {
  const trackedId = leadIdFromTracking(payload);
  if (trackedId) {
    const hit = await db.query.leads.findFirst({
      where: eq(leads.id, trackedId),
      columns: { id: true },
    });
    if (hit) return hit.id;
  }

  const handle = igHandleFromAnswers(payload);
  if (handle) {
    const hit = await db.query.leads.findFirst({
      where: eq(leads.igHandleKey, handle),
      orderBy: [desc(leads.lastContactAt), desc(leads.leadCreatedAt)],
      columns: { id: true },
    });
    if (hit) return hit.id;
  }

  const email = payload.email?.trim().toLowerCase();
  if (email) {
    const hit = await db.query.leads.findFirst({
      where: and(eq(leads.email, email), eq(leads.isTest, false)),
      orderBy: [desc(leads.lastContactAt), desc(leads.leadCreatedAt)],
      columns: { id: true },
    });
    if (hit) return hit.id;
  }

  return null;
}
