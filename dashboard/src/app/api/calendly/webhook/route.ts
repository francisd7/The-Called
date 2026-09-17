import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { bookingLinks, calendlyWebhookEvents, leadEvents, leads } from '@/db/schema';
import {
  igHandleFromAnswers,
  leadIdFromTracking,
  normalizeIgHandle,
  verifyCalendlySignature,
  type CalendlyInviteePayload,
  type CalendlyWebhookBody,
} from '@/lib/calendly';

export const runtime = 'nodejs';
// The signature covers the exact bytes Calendly sent, so this route must never
// be statically optimized or have its body re-serialized.
export const dynamic = 'force-dynamic';

type MatchResult = { leadId: string; strategy: string } | { leadId: null; strategy: 'unmatched' };

/**
 * Three ways in, tried best-first:
 *  1. utm_content - the link came from this dashboard, so it carries the lead id
 *  2. the booking form's Instagram question - booked from a link we didn't stamp
 *  3. email - only works for a lead we already captured an email for
 */
async function matchLead(payload: CalendlyInviteePayload): Promise<MatchResult> {
  const trackedId = leadIdFromTracking(payload);
  if (trackedId) {
    const hit = await db.query.leads.findFirst({ where: eq(leads.id, trackedId) });
    if (hit) return { leadId: hit.id, strategy: 'utm_content' };
  }

  const handle = igHandleFromAnswers(payload);
  if (handle) {
    const hit = await db.query.leads.findFirst({ where: eq(leads.igHandle, handle) });
    if (hit) return { leadId: hit.id, strategy: 'ig_handle_answer' };
  }

  const email = payload.email?.trim().toLowerCase();
  if (email) {
    const hit = await db.query.leads.findFirst({ where: eq(leads.email, email) });
    if (hit) return { leadId: hit.id, strategy: 'email' };
  }

  return { leadId: null, strategy: 'unmatched' };
}

async function resolveBookingLink(payload: CalendlyInviteePayload) {
  const eventTypeUri = payload.scheduled_event?.event_type;
  if (!eventTypeUri) return null;
  return (
    (await db.query.bookingLinks.findFirst({
      where: eq(bookingLinks.eventTypeUri, eventTypeUri),
    })) ?? null
  );
}

async function handleCreated(leadId: string, payload: CalendlyInviteePayload) {
  const link = await resolveBookingLink(payload);
  const startTime = payload.scheduled_event?.start_time;

  await db
    .update(leads)
    .set({
      callBooked: true,
      callBookedAt: new Date(),
      callScheduledFor: startTime ? new Date(startTime) : null,
      bookingLinkId: link?.id ?? null,
      closerId: link?.closerId ?? null,
      calendlyEventUri: payload.scheduled_event?.uri ?? null,
      calendlyInviteeUri: payload.uri ?? null,
      calendlyCancelUrl: payload.cancel_url ?? null,
      calendlyRescheduleUrl: payload.reschedule_url ?? null,
      // A rebooking clears the previous cancellation and resets the setter's
      // work - the new call needs confirming and triaging on its own.
      callCancelled: false,
      callCancelledAt: null,
      cancelReason: null,
      confirmed: false,
      confirmedAt: null,
      confirmedById: null,
      confirmationMethod: null,
      triaged: false,
      triagedAt: null,
      triagedById: null,
      name: payload.name?.trim() || undefined,
      email: payload.email?.trim().toLowerCase() || undefined,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await db.insert(leadEvents).values({
    leadId,
    type: 'call_booked',
    toValue: startTime ?? null,
    meta: { source: 'calendly', inviteeUri: payload.uri, closer: link?.label ?? null },
  });
}

async function handleCanceled(leadId: string, payload: CalendlyInviteePayload) {
  const reason = payload.cancellation?.reason?.trim() || null;
  await db
    .update(leads)
    .set({
      callCancelled: true,
      callCancelledAt: new Date(),
      cancelReason: reason,
      confirmed: false,
      confirmedAt: null,
      confirmedById: null,
      confirmationMethod: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await db.insert(leadEvents).values({
    leadId,
    type: 'call_cancelled',
    toValue: reason,
    meta: { source: 'calendly', canceledBy: payload.cancellation?.canceled_by ?? null },
  });
}

export async function POST(request: Request) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error('CALENDLY_WEBHOOK_SIGNING_KEY is not set - refusing to process webhook');
    return NextResponse.json({ error: 'not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const verdict = verifyCalendlySignature(
    rawBody,
    request.headers.get('calendly-webhook-signature'),
    signingKey
  );
  if (!verdict.ok) {
    console.warn('Rejected Calendly webhook:', verdict.reason);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: CalendlyWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventType = body.event ?? 'unknown';
  const payload = body.payload ?? {};
  const inviteeUri = payload.uri ?? null;

  // Calendly retries on non-2xx, so an already-processed delivery must be a
  // no-op rather than a second booking event on the lead's timeline.
  if (inviteeUri) {
    const seen = await db.query.calendlyWebhookEvents.findFirst({
      where: and(
        eq(calendlyWebhookEvents.eventType, eventType),
        eq(calendlyWebhookEvents.calendlyInviteeUri, inviteeUri)
      ),
    });
    if (seen?.processedAt) return NextResponse.json({ ok: true, deduped: true });
  }

  const [logged] = await db
    .insert(calendlyWebhookEvents)
    .values({ eventType, calendlyInviteeUri: inviteeUri, payload: body })
    .returning({ id: calendlyWebhookEvents.id });

  try {
    const match = await matchLead(payload);

    if (match.leadId) {
      if (eventType === 'invitee.created') await handleCreated(match.leadId, payload);
      else if (eventType === 'invitee.canceled') await handleCanceled(match.leadId, payload);
    }

    await db
      .update(calendlyWebhookEvents)
      .set({
        matchedLeadId: match.leadId,
        matchStrategy: match.strategy,
        processedAt: new Date(),
      })
      .where(eq(calendlyWebhookEvents.id, logged.id));

    // An unmatched booking is a real call on the calendar that nobody owns, so
    // it stays queued for a human rather than being retried or dropped.
    return NextResponse.json({ ok: true, matched: Boolean(match.leadId), strategy: match.strategy });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Calendly webhook processing failed:', message);
    await db
      .update(calendlyWebhookEvents)
      .set({ error: message })
      .where(eq(calendlyWebhookEvents.id, logged.id));
    // 500 so Calendly retries - the raw payload is already stored either way.
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

/** Bookings that landed on nobody - the queue a human has to resolve by hand. */
export async function GET() {
  const rows = await db.query.calendlyWebhookEvents.findMany({
    where: and(
      isNull(calendlyWebhookEvents.matchedLeadId),
      eq(calendlyWebhookEvents.eventType, 'invitee.created')
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 100,
  });
  return NextResponse.json({
    unmatched: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      invitee: (r.payload as { payload?: { name?: string; email?: string } })?.payload ?? null,
    })),
  });
}
