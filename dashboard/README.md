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

Deployment steps (Railway, Google sign-in, Calendly webhook, loading the data)
are in [`DEPLOYMENT.md`](DEPLOYMENT.md). Short version: keep the existing Railway
project and add this as a second service with root directory `dashboard`.

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

Wire it up once, against the deployed URL:

```bash
CALENDLY_PAT=... PUBLIC_URL=https://<domain> npm run setup-calendly
```

That resolves the organization, matches the three Calendly event types to the
three offers (storing each event type URI — the webhook needs them to tell
offers apart), and registers the `invitee.created` / `invitee.canceled`
subscription with `CALENDLY_WEBHOOK_SIGNING_KEY`. Re-running won't duplicate the
webhook. `--dry-run` reports without writing.

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
npm run dev           # local dev server
npm run build         # production build
npm test              # signature, matching, date and Discord tests
npm run typecheck
npm run db:generate   # write a migration from schema.ts
npm run db:migrate    # apply migrations
npm run db:studio     # browse the database
npm run seed           # people, the three offers, baseline dropdowns
npm run import-leads   # pull the Airtable lead tracker into Postgres
npm run setup-calendly # link the offers to Calendly and register the webhook
```

## Migrating the Airtable leads

```bash
AIRTABLE_PAT=... npm run import-leads
AIRTABLE_PAT=... npm run import-leads -- --dry-run     # counts only, writes nothing
npm run import-leads -- --from-file snapshot.json      # from a saved export
```

Idempotent: every row is keyed on its Airtable record id, so a second run
updates rather than duplicating. Run it again immediately before cutover to pick
up whatever changed in Airtable in the meantime.

Nothing is dropped. Fields without a column of their own (Analytics Stage, which
duplicated Conversation Stage) are kept verbatim in a `legacy` JSON column, and
the single Airtable `Notes` blob becomes the first entry in each lead's note
thread. Dropdown options are built from the values actually in use rather than
Airtable's full choice lists — 110 of them, against roughly 150 defined.

Two things the real data forced:

- **IG handles are not unique.** 22 are duplicated across the 541 rows, and 7
  hold a person's name rather than a handle. There is no unique constraint;
  handle-based matching takes the most recently active row.
- **432 of 541 leads have no setter**, including 65 of the 68 booked calls.
  Historical attribution is mostly absent — worth knowing before reading any
  per-setter number off imported data.

## Who can sign in

Access is the `users` table, not Google. A valid Google login for an address
that isn't an active row is rejected.

| | Role | Signs in? |
|---|---|---|
| Francis | admin | yes |
| Loui, Alexis | setter | yes |
| Nigel, Andrew | closer | **no** |

Closers deliberately have no login. They get the pre-call brief pushed to
Discord when a setter saves triage notes, which is where they already read
pre-call notes. Their rows exist so bookings can be attributed to them — which
means their email must match their Calendly account email.

## Deploying to Railway

Add a **second service** to the existing project, pointed at this repo with
**Root Directory** set to `dashboard`. Railway detects Next.js and runs
`npm install` / `npm run build` / `npm start`. Point the Postgres instance's
`DATABASE_URL` at it via a service variable reference so there's one database
for both services.

Health check path: `/health`.
