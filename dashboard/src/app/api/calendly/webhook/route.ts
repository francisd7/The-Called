import { NextResponse } from 'next/server';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { calendlyEventTypes, calendlyWebhookEvents, leadEvents, leads, offers, users } from '@/db/schema';
import { notifyBooking } from '@/lib/discord';
import { recordIssue } from '@/lib/issues';
import { countedEventTypes, isCountedEventType } from '@/lib/offerScope';
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
      calendlyEventTypeUri: payload.scheduled_event?.event_type ?? null,
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

  if (updated) {
    // Name the Calendly link when no offer matches it. Four of the five links
    // that count are retired and have no offer row, so "Offer: —" would be the
    // normal case rather than the exception.
    const link = payload.scheduled_event?.event_type
      ? await db.query.calendlyEventTypes.findFirst({
          where: eq(calendlyEventTypes.uri, payload.scheduled_event.event_type),
        })
      : null;
    // Who is on it, and who might take it. Both read off the users table so
    // adding or standing down a closer changes the message on its own.
    const [setter, closers] = await Promise.all([
      updated.setterId
        ? db.query.users.findFirst({ where: eq(users.id, updated.setterId) })
        : null,
      db.query.users.findMany({
        where: and(eq(users.role, 'closer'), eq(users.active, true)),
        orderBy: [asc(users.createdAt)],
      }),
    ]);

    const posted = await notifyBooking(updated, offer?.label ?? link?.name ?? null, {
      setterName: setter?.name ?? null,
      closers: closers.map((c) => c.name),
    });
    // A booking nobody is told about is the one failure this path exists to
    // prevent. postToChannel returns false for a missing token, a missing
    // channel id and a rejected post alike, and used to say so only to a
    // console nobody reads - so a real call sat in the dashboard while the
    // team waited for a ping that was never coming.
    if (!posted && !updated.isTest) {
      await recordIssue({
        title: 'A booking did not reach Discord',
        detail:
          `${updated.igHandle} booked a call and the dashboard recorded it, but the Discord ` +
          'post did not go out. The booking itself is safe - this is only the notification.',
        remedy:
          'Check DISCORD_BOT_TOKEN and DISCORD_SETTER_CHANNEL_ID are set on this service, and ' +
          'that the bot can post in that channel. Tell whoever is taking the call in the ' +
          'meantime.',
        context: { leadId: updated.id, igHandle: updated.igHandle },
      });
    }
  }
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
    const linked = countedEventTypes(await db.select().from(calendlyEventTypes));
    if (!isCountedEventType(payload.scheduled_event?.event_type, linked)) {
      await db
        .update(calendlyWebhookEvents)
        .set({
          matchStrategy: linked.size === 0 ? 'no_links_counted' : 'not_a_counted_link',
          processedAt: new Date(),
        })
        .where(eq(calendlyWebhookEvents.id, logged.id));

      if (linked.size === 0) {
        await recordIssue({
          title: 'Calendly bookings are being ignored',
          detail:
            'A booking arrived but no Calendly link is marked as a sales call, so there is no ' +
            'way to tell one from a coaching call or a personal appointment.',
          remedy:
            'Open Admin → Setup & imports, press Find Calendly links, and tick the ones whose ' +
            'bookings are sales calls. The delivery is stored and can be replayed afterwards.',
        });
      } else {
        // Some links count and this one doesn't. That is usually correct - a
        // coaching call or somebody's own meeting - but it is also exactly what
        // a brand new sales link looks like, and until now the booking simply
        // vanished: no lead, no Discord, and nothing on the Problems page to
        // say why. Silence is the wrong answer to "did that come through?".
        const uri = payload.scheduled_event?.event_type ?? null;
        const known = uri ? await db.query.calendlyEventTypes.findFirst({
          where: eq(calendlyEventTypes.uri, uri),
        }) : null;
        await recordIssue({
          title: 'A booking came in on a link that is not counted',
          detail:
            `${payload.name?.trim() || payload.email || 'Somebody'} booked on ` +
            `${known ? `"${known.name}"` : 'a link this dashboard has never seen'}, which is not ` +
            'ticked as a sales call. No lead was touched and nobody was told.',
          remedy: known
            ? 'If that link is a sales call, tick it under Admin → Setup & imports → Which ' +
              'Calendly links are sales calls, then pull the Calendly history to bring the ' +
              'booking in. If it is not, nothing needs doing.'
            : 'Open Admin → Setup & imports and press Find Calendly links so the dashboard knows ' +
              'about it, then tick it if its bookings are sales calls.',
          context: { eventTypeUri: uri, inviteeUri: payload.uri },
        });
      }

      // Recorded, not acted on. The payload is kept either way, so a booking
      // wrongly filtered out can still be replayed.
      return NextResponse.json({ ok: true, ignored: 'not_a_counted_link' });
    }

    const match = await matchLead(payload);
    let leadId = match.leadId;
    let strategy = match.strategy;

    // A booking that matches nobody used to stop here: no lead, no Discord,
    // nothing but a row in the delivery log. That is backwards. An unmatched
    // booking is a real call on a real calendar that *nobody owns and nobody
    // is preparing for* - more urgent than a matched one, not less. The
    // Calendly history backfill has always created a lead in this case; the
    // webhook, which is the one that runs while it still matters, did not.
    if (!leadId && eventType === 'invitee.created') {
      const handle = igHandleFromAnswers(payload);
      const name = payload.name?.trim() || null;
      const email = payload.email?.trim().toLowerCase() || null;
      const [row] = await db
        .insert(leads)
        .values({
          // Whatever we have to call them by. No handle on the booking form
          // means there is nothing to key on, so a person fills it in rather
          // than the app inventing one.
          igHandle: handle ?? name ?? email ?? 'unknown booking',
          igHandleKey: handle ?? null,
          needsHandle: !handle,
          name,
          email,
          // Anyone who books has replied, and it is live by definition.
          responded: true,
          respondedAt: new Date(),
          isActiveConvo: true,
          leadCreatedAt: new Date(),
          lastContactAt: new Date(),
        })
        .returning({ id: leads.id });
      leadId = row.id;
      strategy = 'created_from_booking';
      await db.insert(leadEvents).values({
        leadId,
        type: 'created',
        meta: { source: 'calendly_webhook', inviteeUri: payload.uri } as never,
      });
      await recordIssue({
        title: 'A call was booked by somebody not in the tracker',
        detail:
          `${name || email || 'Somebody'} booked a call and matched no lead, so one was created ` +
          'for them. Nobody owns it and it has no Instagram handle yet.',
        remedy:
          'Open the lead, put the real handle in and set a setter. If they are already in the ' +
          'tracker under another row, merge the two from Possible duplicates.',
        context: { leadId, email },
      });
    }

    if (leadId) {
      if (eventType === 'invitee.created') await handleCreated(leadId, payload);
      else if (eventType === 'invitee.canceled') await handleCanceled(leadId, payload);
    }

    await db
      .update(calendlyWebhookEvents)
      .set({
        matchedLeadId: leadId,
        matchStrategy: strategy,
        processedAt: new Date(),
      })
      .where(eq(calendlyWebhookEvents.id, logged.id));

    // An unmatched booking is a real call on someone's calendar, so it stays
    // queued for a human rather than being retried forever or dropped.
    return NextResponse.json({ ok: true, matched: Boolean(leadId), strategy });
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
