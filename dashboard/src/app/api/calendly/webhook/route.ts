import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { calendlyWebhookEvents, leadEvents, leads, offers, users } from '@/db/schema';
import { notifyBooking } from '@/lib/discord';
import { recordIssue } from '@/lib/issues';
import { isOurEventType, linkedEventTypes } from '@/lib/offerScope';
import {
  hostFromPayload,
  igHandleFromAnswers,
  leadIdFromTracking,
  phoneFromPayload,
  verifyCalendlySignature,
  type CalendlyInviteePayload,
  type CalendlyWebhookBody,
} from '@/lib/calendly';

export const runtime = 'nodejs';
// The signature covers the exact bytes Calendly sent, so this route must never
// be statically optimized or have its body re-serialized.
export const dynamic = 'force-dynamic';

type MatchResult = { leadId: string | null; strategy: string };

/**
 * Three ways in, tried best-first:
 *  1. utm_content - the link came from this dashboard, so it carries the lead id
 *  2. the booking form's Instagram question - booked off a link we didn't stamp
 *  3. email - only works for a lead we already have an email for
 *
 * 2 and 3 can hit more than one row: the tracker has 22 duplicated handles, and
 * nothing stops two leads sharing an email. Most recently active wins, which is
 * the row a setter is actually working.
 */
async function matchLead(payload: CalendlyInviteePayload): Promise<MatchResult> {
  const trackedId = leadIdFromTracking(payload);
  if (trackedId) {
    const hit = await db.query.leads.findFirst({ where: eq(leads.id, trackedId) });
    if (hit) return { leadId: hit.id, strategy: 'utm_content' };
  }

  const handle = igHandleFromAnswers(payload);
  if (handle) {
    const hit = await db.query.leads.findFirst({
      where: eq(leads.igHandleKey, handle),
      orderBy: [desc(leads.lastContactAt), desc(leads.leadCreatedAt)],
    });
    if (hit) return { leadId: hit.id, strategy: 'ig_handle_answer' };
  }

  const email = payload.email?.trim().toLowerCase();
  if (email) {
    const hit = await db.query.leads.findFirst({
      where: eq(leads.email, email),
      orderBy: [desc(leads.lastContactAt), desc(leads.leadCreatedAt)],
    });
    if (hit) return { leadId: hit.id, strategy: 'email' };
  }

  return { leadId: null, strategy: 'unmatched' };
}

async function resolveOffer(payload: CalendlyInviteePayload) {
  const eventTypeUri = payload.scheduled_event?.event_type;
  if (!eventTypeUri) return null;
  return (await db.query.offers.findFirst({ where: eq(offers.eventTypeUri, eventTypeUri) })) ?? null;
}

/** Nigel or Andrew, by the email on their Calendly host record. */
async function resolveCloser(email: string | null) {
  if (!email) return null;
  return (await db.query.users.findFirst({ where: eq(users.email, email) })) ?? null;
}

async function handleCreated(leadId: string, payload: CalendlyInviteePayload) {
  const offer = await resolveOffer(payload);
  const host = hostFromPayload(payload);
  const closer = await resolveCloser(host.email);
  const rawStart = payload.scheduled_event?.start_time;
  const parsedStart = rawStart ? new Date(rawStart) : null;
  // An unparseable start_time would otherwise reach the driver as an Invalid
  // Date and fail the whole write, losing a real booking over a bad field.
  const startTime =
    parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null;
  const phone = phoneFromPayload(payload);

  const [updated] = await db
    .update(leads)
    .set({
      callBooked: true,
      callBookedAt: new Date(),
      // Someone who books a call has obviously replied. Setting it here stops
      // the funnel drifting back into showing more bookings than replies.
      responded: true,
      // A booking is a live conversation by definition.
      isActiveConvo: true,
      callScheduledFor: startTime,
      offerId: offer?.id ?? null,
      closerId: closer?.id ?? null,
      closerName: closer?.name ?? host.name,
      calendlyEventUri: payload.scheduled_event?.uri ?? null,
      calendlyInviteeUri: payload.uri ?? null,
      // Kept on the lead so a setter can read what they wrote before the call,
      // instead of it being buried in the raw webhook log.
      calendlyAnswers:
        payload.questions_and_answers && payload.questions_and_answers.length > 0
          ? payload.questions_and_answers
          : null,
      calendlyCancelUrl: payload.cancel_url ?? null,
      calendlyRescheduleUrl: payload.reschedule_url ?? null,
      // A rebooking clears the previous cancellation and resets the setter's
      // work: the new call needs confirming and triaging on its own, and a
      // stale "triaged" flag would tell a closer the prospect was warmed up
      // when nobody has spoken to them about this call.
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
      // Booking is where a phone number enters the system at all, so never
      // overwrite one we already have with nothing.
      ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
      ...(payload.email?.trim() ? { email: payload.email.trim().toLowerCase() } : {}),
      ...(phone ? { phone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
    .returning();

  await db.insert(leadEvents).values({
    leadId,
    type: 'call_booked',
    toValue: startTime?.toISOString() ?? null,
    meta: { source: 'calendly', inviteeUri: payload.uri, offer: offer?.label ?? null },
  });

  if (updated) await notifyBooking(updated, offer?.label ?? null);
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
    await recordIssue({
      title: 'Calendly bookings are being dropped',
      detail: 'A booking arrived but CALENDLY_WEBHOOK_SIGNING_KEY is not set on this service.',
      remedy:
        'Set CALENDLY_WEBHOOK_SIGNING_KEY in Railway to the same value used when the webhook was registered, then press Connect Calendly on this page.',
    });
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
    await recordIssue({
      title: 'Calendly bookings are being rejected',
      detail: `A delivery failed signature checks (${verdict.reason}). Real bookings are not reaching the dashboard.`,
      remedy:
        'CALENDLY_WEBHOOK_SIGNING_KEY no longer matches what Calendly was registered with. Delete the subscription in Calendly, then press Connect Calendly on this page to register a fresh one.',
    });
    // Recorded so a rejection is visible in the app rather than only in the
    // deploy logs. The most likely cause is a signing key that no longer
    // matches the one Calendly was registered with, and the symptom of that is
    // bookings silently never arriving - which looks identical to nobody
    // booking. The body is deliberately NOT stored: it failed verification, so
    // nothing in it is trustworthy.
    try {
      await db.insert(calendlyWebhookEvents).values({
        eventType: 'rejected',
        payload: { reason: verdict.reason },
        error: `Signature rejected: ${verdict.reason}`,
        processedAt: new Date(),
      });
    } catch (err) {
      console.error('Could not record the rejected delivery:', err);
    }
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: CalendlyWebhookBody;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    // JSON.parse accepts `null` and bare arrays, both of which then blow up on
    // the first property access. A signed-but-malformed body is a bad request,
    // not a server error.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'expected a json object' }, { status: 400 });
    }
    body = parsed as CalendlyWebhookBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventType = body.event ?? 'unknown';
  const payload = body.payload ?? {};
  const inviteeUri = payload.uri ?? null;

  // Calendly retries on non-2xx, so a redelivery must be a no-op rather than a
  // second booking event on the lead's timeline.
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
    // The webhook fires for every link on the Calendly account, not just the
    // three offers. A booking on anything else is somebody's own meeting, and
    // writing it into the lead tracker is how internal calls ended up in there.
    const linked = linkedEventTypes(await db.select().from(offers));
    if (!isOurEventType(payload.scheduled_event?.event_type, linked)) {
      await db
        .update(calendlyWebhookEvents)
        .set({
          matchStrategy: linked.size === 0 ? 'no_offers_linked' : 'not_an_offer_link',
          processedAt: new Date(),
        })
        .where(eq(calendlyWebhookEvents.id, logged.id));

      if (linked.size === 0) {
        await recordIssue({
          title: 'Calendly bookings are being ignored',
          detail:
            'A booking arrived but no offer is linked to a Calendly event type, so there is no ' +
            'way to tell a sales call from anyone else on the account.',
          remedy:
            'Press Connect Calendly on this page to link the three offers, then replay the ' +
            'delivery from Calendly deliveries below.',
        });
      }

      // Recorded, not acted on. The payload is kept either way, so a booking
      // wrongly filtered out can still be replayed.
      return NextResponse.json({ ok: true, ignored: 'not_an_offer_link' });
    }

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

    // An unmatched booking is a real call on someone's calendar, so it stays
    // queued for a human rather than being retried forever or dropped.
    return NextResponse.json({ ok: true, matched: Boolean(match.leadId), strategy: match.strategy });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Calendly webhook processing failed:', message);
    await recordIssue({
      title: 'A Calendly booking could not be processed',
      detail: message,
      remedy: 'Check Calendly deliveries below - the raw payload is stored and Calendly will retry.',
      context: { inviteeUri },
    });
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
    orderBy: [desc(calendlyWebhookEvents.createdAt)],
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
