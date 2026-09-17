# Deploying the setter dashboard

**Keep your existing Railway project.** Add the dashboard as a *second service*
inside it, alongside the automation hub. Two services in one project share
variables and a database and cost one Postgres instance; a second project would
mean a second database and no shared references.

Order matters — the database has to exist before the dashboard boots.

---

## 0. Where you run these commands (Windows)

A few steps need a terminal. Set this up once and the rest is copy-paste.

**Install [Node.js LTS](https://nodejs.org)** (skip if `node --version` already
prints something), then open **PowerShell** and run:

```powershell
npm install -g @railway/cli
railway login
git clone https://github.com/francisd7/The-Called.git
cd The-Called\dashboard
npm install
railway link          # pick this project, then the dashboard service
```

From then on, prefix any command with `railway run` and it executes on your
machine with the **live Railway variables injected** — no copying secrets into a
local file:

```powershell
railway run npm run db:migrate
```

`railway shell` opens a session with the variables already loaded if you'd
rather not prefix every command.

**One PowerShell gotcha, if you ever do run curl by hand:** PowerShell aliases
`curl` to `Invoke-WebRequest`, which does not understand `-H` the way curl does.
Use `curl.exe` (with the extension) or Command Prompt instead. Nothing in this
guide needs it — the Calendly setup is a script for exactly this reason.

---

## 1. Add Postgres (2 min)

In your existing Railway project: **New → Database → Add PostgreSQL**.

Railway creates it with a `DATABASE_URL` you'll reference in step 3. Don't copy
the value by hand — step 3 uses a reference so it stays correct if Railway ever
rotates it.

## 2. Add the dashboard service (3 min)

**New → GitHub Repo → `francisd7/The-Called`**. Then in the new service's
**Settings**:

| Setting | Value |
|---|---|
| Root Directory | `dashboard` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Healthcheck Path | `/health` |

Root Directory is the important one — it's what stops Railway from building the
automation hub again.

Then **Settings → Networking → Generate Domain**. Note the URL; steps 3 and 5
both need it.

## 3. Set the variables (5 min)

On the dashboard service, **Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — type it exactly, including the braces. That's a Railway reference, not a literal. |
| `AUTH_SECRET` | Output of `openssl rand -base64 32` (or any 32+ random characters). |
| `AUTH_URL` | The domain from step 2, e.g. `https://dashboard-production-xxxx.up.railway.app` |
| `AUTH_GOOGLE_ID` | From step 4 |
| `AUTH_GOOGLE_SECRET` | From step 4 |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Invent one now — `openssl rand -hex 32`. Step 5 registers the same value with Calendly. |
| `DISCORD_BOT_TOKEN` | The same token the automation hub already uses. |
| `DISCORD_TRIAGE_CHANNEL_ID` | The channel where Nigel and Andrew should receive pre-call notes. |
| `DISCORD_SETTER_CHANNEL_ID` | Where "call booked" notices go. Can be the same channel. |

## 4. Google sign-in (5 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → OAuth consent screen** → External → fill in the app name
   and your email. You do **not** need to submit for verification: with fewer
   than 100 users, adding the five of you as Test Users is enough.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Web application.
4. Under **Authorized redirect URIs** add exactly:
   `https://<your-domain>/api/auth/callback/google`
5. Copy the client ID and secret into the variables from step 3.

## 5. Calendly webhook (5 min)

Webhooks need a paid plan. Nigel's account is on Teams, so this works.

**Get a token:** calendly.com → **Integrations & apps → API & webhooks →
Personal Access Tokens → Generate**. It must be from the account that owns the
three booking links — a token without organization-admin rights gets a 403 here.
Don't paste it into chat or email; it goes straight into the command below.

**Run the setup script.** From `The-Called\dashboard` in PowerShell:

```powershell
$env:CALENDLY_PAT = "paste-the-token-here"
railway run npm run setup-calendly -- --dry-run     # shows what it will do
railway run npm run setup-calendly                  # does it
```

It finds your organization, matches the three Calendly event types to the three
offers (storing each event type URI, which is how a booking is traced back to
the offer it came from), and registers the webhook with the signing key from
step 3. Re-running is safe — it won't create a second webhook.

If an offer comes back unmatched, its scheduling URL in `scripts/seed.ts`
doesn't match the real Calendly one. Fix it, re-run `npm run seed`, then re-run
this.

Close the PowerShell window afterwards so the token doesn't sit in that
session's history.

**Add the booking-form questions.** For each of the three event types, edit the
booking page and add:

- **Instagram handle** — required. This is the fallback that matches a booking
  to a lead when someone books off a link that wasn't generated in the
  dashboard. Without it, those bookings land in the unmatched queue.
- **Phone number** — you already have this. Leave it on: triage is a phone
  call, and this is the only point in the funnel where a number is captured.

## 6. Load the data (5 min)

From `The-Called\dashboard` in PowerShell:

```powershell
railway run npm run db:migrate        # create the tables
railway run npm run seed              # people, the 3 offers, dropdowns

$env:AIRTABLE_PAT = "paste-the-airtable-token-here"
railway run npm run import-leads      # all 541 leads from Airtable
```

The Airtable token is the same one the automation hub already uses, or a fresh
read-only one from [airtable.com/create/tokens](https://airtable.com/create/tokens)
with `data.records:read` on the **The Called Lead Tracker** base.

`import-leads` is safe to re-run: rows are keyed on their Airtable record id, so
a second run updates rather than duplicates. Run it again right before you cut
over, to pick up anything the setters changed in Airtable in the meantime.

Add `--dry-run` to see the counts without writing.

## 7. Fix the placeholder emails

`scripts/seed.ts` ships with `CHANGEME` addresses for Loui, Alexis, Nigel and
Andrew. Two things break until they're real:

- Setters can't sign in — the allowlist matches on email.
- Bookings won't attribute to a closer. Nigel's and Andrew's rows must carry the
  **email on their Calendly account**, which is what the webhook matches against.

Edit the file and re-run `npm run seed`, or update the rows directly.

---

## Checking it works

Open `https://<your-domain>/health` in a browser — it should show
`{"status":"ok"}`.

Then book a real test call through one of the three links and watch it appear
under **Today**. If it lands in **Admin → Unmatched bookings** instead, the
booking form is missing its Instagram question, or the link used wasn't one the
dashboard generated.

## What this does *not* touch

The automation hub keeps running exactly as it does now, still reading Airtable.
Nothing in this deploy changes it. Airtable stays the system of record for
everything except the setters' lead work until you decide to move the next piece
— see `docs/Setter_Dashboard_Plan.md`.
