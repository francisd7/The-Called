/**
 * One command to wire up Calendly. Replaces a sequence of hand-run curl calls
 * that are awkward on Windows, where PowerShell aliases `curl` to
 * Invoke-WebRequest and the -H flags don't mean what they look like.
 *
 *   CALENDLY_PAT=... PUBLIC_URL=https://your-domain npm run setup-calendly
 *   ... --dry-run     # report what it would do, change nothing
 *
 * It:
 *   1. finds the organization behind the token
 *   2. matches the three Calendly event types to the offers table and stores
 *      each event type URI (the webhook needs these to tell offers apart)
 *   3. registers the invitee.created / invitee.canceled webhook, skipping it if
 *      an identical one already exists
 *
 * Safe to re-run.
 */
import { eq } from 'drizzle-orm';
import { db, sql } from './db.ts';
import { offers } from '../src/db/schema.ts';

// Overridable so this can be exercised against a stub without touching the
// real Calendly account.
const API = process.env.CALENDLY_API_BASE ?? 'https://api.calendly.com';

type EventType = { uri: string; name: string; scheduling_url: string; active: boolean };

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
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const pat = process.env.CALENDLY_PAT;
  const publicUrl = process.env.PUBLIC_URL ?? process.env.AUTH_URL;
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const dryRun = process.argv.includes('--dry-run');

  if (!pat) throw new Error('CALENDLY_PAT is not set');

  const me = await callApi<{
    resource: { uri: string; name: string; email: string; current_organization: string };
  }>(pat, '/users/me');
  console.log(`Signed in as ${me.resource.name} <${me.resource.email}>`);
  console.log(`Organization: ${me.resource.current_organization}\n`);

  // Organization scope catches event types owned by anyone on the team, which
  // matters because the three links live on Nigel's user, not necessarily on
  // whoever's token this is.
  let eventTypes: EventType[];
  try {
    const res = await callApi<{ collection: EventType[] }>(
      pat,
      `/event_types?organization=${encodeURIComponent(me.resource.current_organization)}&count=100`
    );
    eventTypes = res.collection;
  } catch {
    console.log('Could not list the whole organization; falling back to this user only.');
    const res = await callApi<{ collection: EventType[] }>(
      pat,
      `/event_types?user=${encodeURIComponent(me.resource.uri)}&count=100`
    );
    eventTypes = res.collection;
  }

  console.log(`Found ${eventTypes.length} event types:`);
  for (const et of eventTypes) {
    console.log(`  ${et.active ? '●' : '○'} ${et.name}\n      ${et.scheduling_url}`);
  }
  console.log('');

  const rows = await db.select().from(offers);
  let matched = 0;
  for (const offer of rows) {
    const want = offer.schedulingUrl.replace(/\/+$/, '').toLowerCase();
    const hit = eventTypes.find((et) => et.scheduling_url.replace(/\/+$/, '').toLowerCase() === want);

    if (!hit) {
      console.log(`✗ ${offer.label}\n    no Calendly event type matches ${offer.schedulingUrl}`);
      continue;
    }
    matched += 1;
    console.log(`✓ ${offer.label}\n    ${hit.uri}`);
    if (!dryRun) {
      await db.update(offers).set({ eventTypeUri: hit.uri }).where(eq(offers.id, offer.id));
    }
  }
  console.log(
    `\n${matched}/${rows.length} offers linked to a Calendly event type${dryRun ? ' (dry run — nothing written)' : ''}`
  );
  if (matched < rows.length) {
    console.log(
      'Unmatched offers still work, but their bookings arrive without an offer attached.\n' +
        'Fix the scheduling URL in scripts/seed.ts (or the offers table) and re-run.'
    );
  }

  if (!publicUrl || !signingKey) {
    console.log(
      '\nSkipping webhook registration: PUBLIC_URL and CALENDLY_WEBHOOK_SIGNING_KEY must both be set.'
    );
    return;
  }

  const webhookUrl = `${publicUrl.replace(/\/+$/, '')}/api/calendly/webhook`;
  const existing = await callApi<{ collection: Array<{ uri: string; callback_url: string; events: string[] }> }>(
    pat,
    `/webhook_subscriptions?organization=${encodeURIComponent(me.resource.current_organization)}&scope=organization&count=100`
  );

  const already = existing.collection.find((w) => w.callback_url === webhookUrl);
  if (already) {
    console.log(`\n✓ Webhook already registered for ${webhookUrl}`);
    console.log(`    ${already.uri}`);
    console.log(
      '    Note: the signing key cannot be read back. If deliveries are rejected with 401,\n' +
        '    delete this subscription in Calendly and re-run to register a fresh one.'
    );
    return;
  }

  if (dryRun) {
    console.log(`\n[dry run] would register a webhook at ${webhookUrl}`);
    return;
  }

  const created = await callApi<{ resource: { uri: string } }>(pat, '/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: me.resource.current_organization,
      scope: 'organization',
      signing_key: signingKey,
    }),
  });
  console.log(`\n✓ Webhook registered at ${webhookUrl}`);
  console.log(`    ${created.resource.uri}`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    if (String(err).includes('403')) {
      console.error(
        '\nA 403 usually means this token lacks organization-admin rights.\n' +
          "Use a token from the Calendly account that owns the booking links (Nigel's)."
      );
    }
    await sql.end();
    process.exit(1);
  });
