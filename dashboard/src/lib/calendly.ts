import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Calendly signs each delivery with:
 *   Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex hmac>
 * where the HMAC is SHA-256 over "<t>.<raw body>" keyed with the signing key
 * chosen when the webhook subscription was created.
 *
 * The raw body must be the exact bytes Calendly sent - re-serializing parsed
 * JSON changes key order/spacing and the signature will never match.
 */
export function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  signingKey: string,
  toleranceSeconds = 300
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing signature header' };

  let timestamp: string | undefined;
  let signature: string | undefined;
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') timestamp = v;
    if (k === 'v1') signature = v;
  }
  if (!timestamp || !signature) return { ok: false, reason: 'malformed signature header' };

  // Rejects a captured delivery being replayed at us later.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { ok: false, reason: 'signature timestamp outside tolerance' };
  }

  const expected = createHmac('sha256', signingKey).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}

export type CalendlyInviteePayload = {
  uri?: string;
  email?: string;
  name?: string;
  cancel_url?: string;
  reschedule_url?: string;
  status?: string;
  scheduled_event?: {
    uri?: string;
    start_time?: string;
    end_time?: string;
    event_type?: string;
    event_memberships?: Array<{ user?: string; user_email?: string; user_name?: string }>;
  };
  tracking?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
    salesforce_uuid?: string | null;
  };
  questions_and_answers?: Array<{ question?: string; answer?: string; position?: number }>;
  cancellation?: { canceled_by?: string; reason?: string; canceler_type?: string };
};

export type CalendlyWebhookBody = {
  event?: string;
  created_at?: string;
  payload?: CalendlyInviteePayload;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalizes an Instagram handle for comparison: strips a leading @, a full
 * profile URL, surrounding whitespace, and case. "@Modia_fit " and
 * "instagram.com/modia_fit/" both land on "modia_fit".
 */
export function normalizeIgHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/^instagram\.com\//, '');
  s = s.split(/[?#]/)[0];
  s = s.replace(/\/+$/, '');
  s = s.replace(/^@+/, '');
  return s.length > 0 ? s : null;
}

/** The lead id we stamped into the booking link, if this booking came from one. */
export function leadIdFromTracking(payload: CalendlyInviteePayload): string | null {
  const candidate = payload.tracking?.utm_content ?? payload.tracking?.salesforce_uuid ?? null;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/** Fallback: the IG handle they typed into the booking form's custom question. */
export function igHandleFromAnswers(payload: CalendlyInviteePayload): string | null {
  for (const qa of payload.questions_and_answers ?? []) {
    const q = (qa.question ?? '').toLowerCase();
    if (q.includes('instagram') || q.includes('ig handle') || q.includes('@')) {
      const handle = normalizeIgHandle(qa.answer);
      if (handle) return handle;
    }
  }
  return null;
}
