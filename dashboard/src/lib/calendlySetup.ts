/**
 * Wires up Calendly: resolves the organization behind the token, links each
 * offer to its Calendly event type, and registers the webhook.
 *
 * `db` is injected so this runs from the admin screen and from a test alike.
 * Safe to re-run - it won't create a second webhook subscription.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { offers } from '../db/schema.ts';
import * as schema from '../db/schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

const API = process.env.CALENDLY_API_BASE ?? 'https://api.calendly.com';

type EventType = { uri: string; name: string; scheduling_url: string; active: boolean };

export type CalendlySetupResult = {
  account: { name: string; email: string; organization: string };
  eventTypes: Array<{ name: string; schedulingUrl: string }>;
  linked: Array<{ offer: string; eventTypeUri: string }>;
  unlinked: Array<{ offer: string; schedulingUrl: string }>;
  webhook: { status: 'created' | 'already_registered' | 'skipped'; url?: string; reason?: string };
};

async function callApi<T>(pat: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('Calendly rejected the token (401). Is it correct?');
    if (res.status === 403) {
      throw new Error(
        'Calendly returned 403. This token lacks organization-admin rights — ' +
          'use one from the account that owns the booking links.'
      );
    }
    throw new Error(`Calendly ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function setupCalendly(
  db: Db,
  { pat, publicUrl, signingKey }: { pat: string; publicUrl?: string; signingKey?: string }
): Promise<CalendlySetupResult> {
  const me = await callApi<{
    resource: { uri: string; name: string; email: string; current_organization: string };
  }>(pat, '/users/me');
  const org = me.resource.current_organization;

  // Organization scope catches event types owned by anyone on the team - the
  // three links live on Nigel's user, not necessarily on whoever's token this is.
  let eventTypes: EventType[];
  try {
    const res = await callApi<{ collection: EventType[] }>(
      pat,
      `/event_types?organization=${encodeURIComponent(org)}&count=100`
    );
    eventTypes = res.collection;
  } catch {
    const res = await callApi<{ collection: EventType[] }>(
      pat,
      `/event_types?user=${encodeURIComponent(me.resource.uri)}&count=100`
    );
    eventTypes = res.collection;
  }

  const rows = await db.select().from(offers);
  const linked: CalendlySetupResult['linked'] = [];
  const unlinked: CalendlySetupResult['unlinked'] = [];

  for (const offer of rows) {
    const want = offer.schedulingUrl.replace(/\/+$/, '').toLowerCase();
    const hit = eventTypes.find(
      (et) => et.scheduling_url.replace(/\/+$/, '').toLowerCase() === want
    );
    if (!hit) {
      unlinked.push({ offer: offer.label, schedulingUrl: offer.schedulingUrl });
      continue;
    }
    await db.update(offers).set({ eventTypeUri: hit.uri }).where(eq(offers.id, offer.id));
    linked.push({ offer: offer.label, eventTypeUri: hit.uri });
  }

  const base = {
    account: { name: me.resource.name, email: me.resource.email, organization: org },
    eventTypes: eventTypes.map((et) => ({ name: et.name, schedulingUrl: et.scheduling_url })),
    linked,
    unlinked,
  };

  if (!publicUrl || !signingKey) {
    return {
      ...base,
      webhook: {
        status: 'skipped',
        reason: 'AUTH_URL and CALENDLY_WEBHOOK_SIGNING_KEY must both be set',
      },
    };
  }

  const webhookUrl = `${publicUrl.replace(/\/+$/, '')}/api/calendly/webhook`;
  const existing = await callApi<{ collection: Array<{ uri: string; callback_url: string }> }>(
    pat,
    `/webhook_subscriptions?organization=${encodeURIComponent(org)}&scope=organization&count=100`
  );

  if (existing.collection.some((w) => w.callback_url === webhookUrl)) {
    return { ...base, webhook: { status: 'already_registered', url: webhookUrl } };
  }

  await callApi(pat, '/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: org,
      scope: 'organization',
      signing_key: signingKey,
    }),
  });

  return { ...base, webhook: { status: 'created', url: webhookUrl } };
}
