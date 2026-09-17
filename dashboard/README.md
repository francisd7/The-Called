# The Called — Setter Dashboard

The tool Loui and Alexis work out of: the lead list, calls booked through
Calendly, confirmations, triage, and EOD reports. Built to replace the Airtable
lead tracker, not sit on top of it.

Lives in the same repo as the automation hub but deploys as its own Railway
service — the hub is a long-running Discord bot + poller, this is a web app, and
one shouldn't restart the other.

## Stack and why

| Choice | Reason |
|---|---|
| Next.js 15 (App Router) | One deploy serves both the UI and the Calendly webhook endpoint. Mobile and desktop from the same code. |
| Postgres (Railway) | Replaces Airtable as the system of record. Railway already hosts the hub, so it's one bill. |
| Drizzle ORM | Schema is a TypeScript file; migrations are generated from it and reviewed in the diff. |
| Auth.js + Google | Five named people. No passwords to manage, works on phones. Access is an allowlist against the `users` table, so a Google login alone gets nobody in. |

## Setup

```bash
cd dashboard
npm install
cp .env.example .env        # fill it in - see below
npm run db:push             # create the tables
npm run dev
```

### Environment

Every variable is documented in `.env.example`. The three that need outside setup:

1. **`DATABASE_URL`** — Railway → New → Database → PostgreSQL, then copy the
   connection string.
2. **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`** — Google Cloud Console → APIs &
   Services → Credentials → OAuth client ID (Web application). Authorized
   redirect URI must be `https://<domain>/api/auth/callback/google`.
3. **`CALENDLY_PAT` / `CALENDLY_WEBHOOK_SIGNING_KEY`** — see below.

## Calendly wiring

Webhooks need a paid Calendly plan (Standard, Teams or Enterprise). Nigel's
account is on Teams, so this works.

Create the subscription once, against the deployed URL:

```bash
curl -X POST https://api.calendly.com/webhook_subscriptions \
  -H "Authorization: Bearer $CALENDLY_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<domain>/api/calendly/webhook",
    "events": ["invitee.created", "invitee.canceled"],
    "organization": "<org uri>",
    "scope": "organization",
    "signing_key": "<same value as CALENDLY_WEBHOOK_SIGNING_KEY>"
  }'
```

Every delivery is HMAC-verified against that signing key and rejected with a 401
if it doesn't match (`src/lib/calendly.ts`). Without the key set, the endpoint
refuses to process anything rather than trusting unsigned input.

### How a booking finds its lead

The lead list is keyed on Instagram handle; Calendly returns name and email.
There is no shared key, so the dashboard creates one: when a setter grabs a
booking link for a lead, it stamps that lead's id into the URL as `utm_content`
(`src/lib/bookingLink.ts`). Calendly echoes it back untouched in the webhook's
`tracking` object.

Matching runs best-first:

1. **`utm_content`** — exact, and the only path that can't be wrong. Requires the
   setter to copy the link from the lead's row rather than paste a generic one.
2. **Instagram handle** from a custom question on the booking form — covers
   anything booked off a link we didn't stamp. Handles `@name`, bare names, and
   full profile URLs.
3. **Email** — only works for leads we already captured one for.

A booking that matches none of the three is **not dropped**: the raw payload is
stored in `calendly_webhook_events` and surfaced as a queue for a human. That's a
real call sitting on someone's calendar, so silence is the one unacceptable
outcome.

A rebooking resets `confirmed` and `triaged` — the new call needs that work done
again, and carrying the old flags forward would quietly tell a closer the
prospect was warmed up when they weren't.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build
npm test             # Calendly signature + matching tests
npm run typecheck
npm run db:generate  # write a migration from schema.ts
npm run db:migrate   # apply migrations
npm run db:studio    # browse the database
```

## Deploying to Railway

Add a **second service** to the existing project, pointed at this repo with
**Root Directory** set to `dashboard`. Railway detects Next.js and runs
`npm install` / `npm run build` / `npm start`. Point the Postgres instance's
`DATABASE_URL` at it via a service variable reference so there's one database
for both services.

Health check path: `/health`.
