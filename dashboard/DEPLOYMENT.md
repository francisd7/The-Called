# Deploying the setter dashboard

**Keep your existing Railway project.** Add the dashboard as a *second service*
inside it, alongside the automation hub. Two services in one project share
variables and a database; a second project would mean a second database.

There is no terminal, CLI or migration command in this process. The service
creates its own tables and seeds itself on boot, and the two data-loading steps
are buttons on the Admin screen.

---

## 1. Add Postgres

**New → Database → Add PostgreSQL** in the existing project.

## 2. Add the dashboard service

**New → GitHub Repo → `francisd7/The-Called`**, then in **Settings**:

| Setting | Value |
|---|---|
| Source → Branch | `claude/elegant-ptolemy-5g32da` |
| Root Directory | `dashboard` |
| Healthcheck Path | `/health` |

Branch and Root Directory are the two that matter. The dashboard lives on that
branch and in that folder; pointing at the default branch builds the automation
hub instead and serves a 404.

Build and start commands come from `package.json` — leave them blank.

Then **Settings → Networking → Generate Domain** and note the URL.

## 3. Set the variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — type it exactly, braces included. It's a Railway reference, not a literal. |
| `AUTH_SECRET` | Any 32+ random characters. |
| `AUTH_URL` | The domain from step 2, with `https://` and **no trailing slash**. |
| `AUTH_GOOGLE_ID` | From step 4 |
| `AUTH_GOOGLE_SECRET` | From step 4 |
| `AIRTABLE_PAT` | The token the automation hub already uses, or a fresh read-only one. Used by the import button. |
| `CALENDLY_PAT` | From step 5. Used by the Connect Calendly button. |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Any 32+ random characters. The dashboard registers this with Calendly and verifies every delivery against it. |
| `DISCORD_BOT_TOKEN` | Same token the automation hub uses. |
| `DISCORD_TRIAGE_CHANNEL_ID` | Where Nigel and Andrew get pre-call briefs. |
| `DISCORD_SETTER_CHANNEL_ID` | Where "call booked" notices go. Can be the same channel. |

On the first successful boot the service creates its tables and seeds the five
people, the three offers and the baseline dropdowns. Nothing to run.

Check `https://<your-domain>/health` — it should return `{"status":"ok"}`.

## 4. Google sign-in

1. [console.cloud.google.com](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → OAuth consent screen** → External. Under 100 users means
   no verification review is needed — add the five of you as Test Users.
3. **Credentials → Create Credentials → OAuth client ID** → Web application.
4. **Authorized redirect URIs**, exactly:
   `https://<your-domain>/api/auth/callback/google`
5. Copy the client ID and secret into step 3's variables.

## 5. Calendly token

Webhooks need a paid plan; Nigel's account is on Teams.

calendly.com → **Integrations & apps → API & webhooks → Personal Access Tokens
→ Generate**. It must come from the account that **owns the three booking
links** — a token without organization-admin rights gets a 403.

Paste it into Railway as `CALENDLY_PAT`. Nothing else to do here; the button in
step 6 uses it.

## 6. Finish in the app

Sign in at your domain, go to **Admin**. There's a Setup checklist with two
buttons:

- **Import leads from Airtable** — pulls the full lead tracker across. Run
  **Test Airtable import** first to see the counts without writing anything.
  Safe to re-run: leads are keyed on their Airtable record id, so a second run
  updates rather than duplicating. Run it again right before you cut over, to
  pick up whatever changed in Airtable in the meantime.
- **Connect Calendly** — links the three offers to their Calendly event types
  and registers the booking webhook. Won't create a duplicate.

The checklist disappears once all four items are green.

## 7. Real email addresses

The five people are seeded with `CHANGEME` placeholder emails. Until they're
replaced:

- Loui and Alexis can't sign in — the allowlist matches on email.
- Bookings won't attribute to a closer. Nigel's and Andrew's rows need the
  **email on their Calendly account**, which is what the webhook matches.

Edit `PEOPLE` in `src/lib/seedBaseline.ts` and push; the next deploy updates
them. (Changing an address there doesn't re-enable anyone deactivated in the
app — the seed never touches `active`.)

## 8. Booking-form questions

On each of the three Calendly event types, check the booking page has:

- **Instagram handle** — required. The fallback that matches a booking to a
  lead when someone books off a link the dashboard didn't generate. Without it,
  those land in Admin → Unmatched bookings.
- **Phone number** — already there. Leave it on: triage is a phone call, and
  this is the only point in the funnel that captures a number.

---

## Checking it works

Book a real test call through one of the three links and watch it appear under
**Today**. If it lands in **Admin → Unmatched bookings** instead, the booking
form is missing its Instagram question and the link used wasn't one the
dashboard generated.

## What this does *not* touch

The automation hub keeps running as it does now, still reading Airtable. Airtable
stays the system of record for everything except the setters' lead work until
you move the next piece — see `docs/Setter_Dashboard_Plan.md`.
