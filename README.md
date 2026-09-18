# The Called — Automation Hub

An always-on Node.js server that replaces what Zapier would have handled: it
watches Airtable for new submissions and posts about them in Discord. This is
shared infrastructure for the automation hub described in
[`docs/Automation_Hub_Blueprint.md`](docs/Automation_Hub_Blueprint.md) — future
automations should extend this server rather than starting a new one. Current
build status: [`docs/STATUS.md`](docs/STATUS.md).

## What's running today

| Automation | Trigger | Action |
|---|---|---|
| Setter EOD → Discord | New record in **Setter EOD** (`EOD Reports` base) | Posts "📋 **[Setter Name]** submitted their EOD report — [Date]" to the `DISCORD_SETTER_EOD_CHANNEL_ID` channel |
| Weekly Check-in → Discord | New record in **Weekly Check-ins** (`Client Success` base) | Posts "✅ **[Client Name]** submitted their Weekly Check-in — Momentum: [X]/10" to the `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` channel |
| Weekly Check-in reminder DMs | Every Friday, `WEEKLY_REMINDER_HOUR_ET`:`WEEKLY_REMINDER_MINUTE_ET` ET (default noon) | DMs every `Status = Active` Client with a Discord ID and no opt-out: "Hey [First Name], time for your Weekly Check-in — [prefilled link]". Posts a send/skip summary to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` right after. |
| New-member onboarding | Someone joins the client-facing Discord server (`DISCORD_CLIENT_GUILD_ID`) | Creates a private `firstname-lastname` channel (visible to them, the bot, and the CSM role), posts the welcome message, then waits for their reply. A reply that looks like an email is matched against the Clients table's `Email` field — matched → writes their Discord ID back to that record; no match (the common case for a genuinely new signup) → creates a starter Client record (Name, Email, Discord ID, Start Date, Status Active) and flags `DISCORD_ONBOARDING_FLAG_CHANNEL_ID` so staff fills in Package/CSM/Contract Value. |
| Client Notion dashboard | A new member replies with their email (instant), or any Active Client record still has an empty `Notion Dashboard URL` (safety net, on the poll interval) | Creates a page in the **Client Dashboards** Notion database from the saved template, fills in Name / Client Email / CSM / Package / Start Date / Status, writes the new page's URL back onto the Airtable record, and posts that link (plus the client's email) to `DISCORD_DASHBOARD_CHANNEL_ID` so a human can do the single step Notion's API cannot: invite the client as a guest. |

The first two notifications go to separate Discord channels (and can be in
separate servers) — the bot just needs to be a member of whichever server
each channel lives in. First three automations are live as of 2026-09-09;
new-member onboarding is built but gated off by default (see below).

## Weekly Check-in reminder DMs — how skipping works

Two independent skip conditions, both logged in the run summary rather than
failed silently:

- **`Discord ID`** blank on the Clients table (`The Called — Client Success`
  base) → skipped until it's filled in.
- **`Skip Weekly Reminder`** checked on the same table → permanently
  skipped even once a Discord ID exists (e.g. once the future new-member
  onboarding automation starts auto-populating Discord ID for other
  reasons) — this always wins over having a Discord ID.

This is gated by `WEEKLY_REMINDER_ENABLED` on the host (currently `true` on
Railway — **live**). To pause it without losing the backfilled Discord IDs or
opt-outs, set it back to anything other than `true` (or delete the variable)
and redeploy; flip it back to `true` to resume. `WEEKLY_REMINDER_HOUR_ET` /
`WEEKLY_REMINDER_MINUTE_ET` (defaults `12` / `0`, 24-hour, America/New_York —
handles the EST/EDT switch automatically) change the send time if needed.

To test a change (new message wording, etc.) without risk, use the
dry-run-only script — it has no code path that can send a real DM, and posts
to a test channel instead:
```
npm run weekly-reminder-dry-run
```
(needs `DISCORD_BOT_TOKEN`, `AIRTABLE_PAT`, and `DISCORD_TEST_CHANNEL_ID` set,
e.g. in a local `.env`)

## New-member onboarding — built, gated off by default

Gated by `NEW_MEMBER_ONBOARDING_ENABLED` (unset/false by default — no channel
gets created, no message gets sent, until this is explicitly `true`). Once
enabled:

| Variable | Required to go live | Notes |
|---|---|---|
| `NEW_MEMBER_ONBOARDING_ENABLED` | Yes | Must be exactly `true` (string). |
| `DISCORD_CLIENT_GUILD_ID` | Yes | The client-facing server's ID — right-click the server icon (Developer Mode on) → **Copy Server ID**. Only joins in this server trigger it. |
| `DISCORD_CSM_ROLE_ID` | Yes | The CSM role that can see every onboarding channel, alongside the new member and the bot itself. |
| `DISCORD_ONBOARDING_FLAG_CHANNEL_ID` | No | Where a newly auto-created starter Client record gets flagged for staff to finish filling in. Defaults to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID`. |
| `NOTION_DASHBOARD_URL` | No | Defaults to a literal `[Insert Link]` placeholder in the welcome message until set. |

Two **Privileged Gateway Intents** must be turned on in the Discord Developer
Portal (Bot tab) before this works — **Server Members Intent** (to detect a
join) and **Message Content Intent** (to read their reply). The server only
requests these intents at all once `NEW_MEMBER_ONBOARDING_ENABLED=true`, so
forgetting this step doesn't break the other three (already-live) automations
— it just makes this one fail to log in until both are on.

The bot also needs standing **Manage Channels** in the client server (Server
Settings → Roles → the bot's role) to create channels on an ongoing basis —
this is different from the temporary Administrator trick used for the
one-time `grant-bot-channel-access` script; here it needs to stay on.

**The Airtable token needs write access now.** #1–#3 only ever read, so
`AIRTABLE_PAT` was scoped to `data.records:read` only. Writing the matched
client's Discord ID back, and creating starter records for unmatched
clients, both require `data.records:write` too — add that scope to the
existing token (or issue a new one) before enabling this.

Design notes:
- Channel name is the member's Discord display name, slugified
  (`Jack Garcia` → `jack-garcia`), with no parent category — avoids the
  per-category permission lockouts hit earlier in this project.
- The exact welcome message copy is in `src/onboarding/welcomeMessage.js`,
  with one addition beyond what was provided: an appended line asking for the
  email they purchased with, since nothing else in the flow can do the
  Discord-to-Airtable matching without it.
- Whop integration for auto-capturing email at purchase (instead of asking in
  Discord) was considered and deliberately deferred — see `docs/STATUS.md`.
- An unmatched email doesn't dead-end waiting on staff: it creates a starter
  Client record immediately (`buildNewClientFields` in
  `newMemberOnboarding.js`) with Status `Active`, so the client is in the
  system from day one and staff only has to fill in the rest (Package, CSM,
  Contract Value, ...) rather than create the record from scratch. This
  exists because a brand-new signup's Airtable record usually doesn't exist
  yet at the moment they join Discord — staff logs the sale by hand, often
  afterward — so a same-message email match is the exception, not the rule,
  for genuinely new clients. Worth knowing: Status `Active` + a Discord ID
  means this client is immediately eligible for the Friday Weekly Check-in
  reminder DM (automation #3), even before a CSM is assigned — a deliberate
  choice, not an oversight.

## Client Notion dashboards — built, gated off by default

Replaces duplicating the Notion dashboard template by hand for every new
client. Gated by `NOTION_DASHBOARD_ENABLED` (unset/false by default — no
Notion page is created and nothing is written back to Airtable until this is
explicitly `true`).

| Variable | Required to go live | Notes |
|---|---|---|
| `NOTION_DASHBOARD_ENABLED` | Yes | Must be exactly `true` (string). |
| `NOTION_TOKEN` | Yes | Internal integration token from notion.so/profile/integrations (starts with `ntn_`). The integration must then be connected to the database: open it → `•••` → **Connections** → add the integration. Without that step every call 404s. |
| `NOTION_DASHBOARDS_DATABASE_ID` | Yes | The 32-character chunk in the database URL: `notion.so/<workspace>/<DATABASE_ID>?v=<view id>`. **This is the only thing that changes when moving from a mock database to the real one.** |
| `NOTION_DASHBOARD_TEMPLATE_NAME` | No | Build each dashboard from the template with this name. Leave unset to use whichever template is marked default on that database. |
| `DISCORD_DASHBOARD_CHANNEL_ID` | No | Where the "created, now go invite them" message lands. Defaults to `DISCORD_ONBOARDING_FLAG_CHANNEL_ID`, then `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID`. |

**How a client actually gets their dashboard**

```
Client joins Discord      → private channel + welcome message
Client replies with email → Client record linked/created
                          → dashboard created from the template
                          → link posted in their own channel, seconds later
                          → staff pinged (@CSM) to invite them as a guest
```

The invite is the one manual step and it can't be automated — Notion has no
permissions API. It happens *after* the client already has the link, which is
a deliberate choice made with that trade-off understood: the client gets an
instant reply rather than waiting on staff. Two things soften the gap — the
staff ping mentions the CSM role and says outright that the client is already
holding the link, and the client's own message warns them they may see a
request-access screen for a minute or two.

There are two entry points into the same code:

- **Instant** (`deliverDashboardOnSignup`) — fires off the email reply inside
  the onboarding flow. This is the one clients experience. It never throws: a
  Notion outage reports to the staff channel rather than breaking the "You're
  all set!" reply or the Airtable record.
- **Safety net** (`createClientDashboards`) — runs on the poll interval and
  picks up any Active client still missing a dashboard: added to Airtable by
  hand, predating this automation, or an instant send that failed. It posts to
  the client's own channel too when `Discord Channel ID` is on the record.

**Setup outside this repo:**

1. ✅ **Done** — `Notion Dashboard URL` and `Discord Channel ID` fields exist on
   the Clients table. Both are written automatically; don't fill them in by
   hand. Clearing the URL is how you force a dashboard to be re-created or
   re-linked.
2. In Notion, the Client Dashboards database needs a database template
   containing the dashboard layout, set as default (`⌄` next to **New** →
   `•••` → **Set as default**), with the integration connected to it.

**Testing against a mock database first:**

```bash
npm run client-dashboard-dry-run          # reads everything, writes nothing
npm run create-one-client-dashboard -- someone@example.com
```

The dry run prints the resolved data source ID, every template it found, every
Notion column and its type, and the exact property payload each client would
get — which is how you confirm a database is wired up correctly before going
live. It has no code path that writes.

`create-one-client-dashboard` makes one real Notion page so you can see the
finished article. It deliberately does **not** write the URL back to Airtable
unless you add `--write-airtable` — writing a mock-database URL onto a real
Client record would make the live automation skip that client later.

Design notes:
- ⚠️ **`NOTION_DASHBOARD_URL` now means something different.** It puts one
  shared link into every welcome message, which was right when there was a
  single dashboard for everyone and is wrong now that each client gets their
  own. It shouldn't be deleted — it's the natural home for the link to the
  shared resources/training page — but the welcome message copy in
  `src/onboarding/welcomeMessage.js` still calls it "your Notion Dashboard",
  which will read as a contradiction next to the personal one. Reword before
  setting it.
- **Notion has no API for sharing a page with a guest.** There is no
  permissions endpoint at all (verified against the official SDK), and
  "Share to web" can't be toggled programmatically either. So inviting the
  client stays a human step — the Discord message carries the link and the
  email so it's a copy-paste, not a lookup. The CSM side needs no per-client
  work at all if the database lives in a teamspace the CSMs are in;
  permissions inherit.
- The trigger is **the absence of a `Notion Dashboard URL`**, not a
  created-time watermark like automations #1/#2. That makes it idempotent
  (a client with a URL is never picked up again), self-healing (a run that
  died halfway resumes next cycle), and it retroactively covers clients who
  existed before this automation did.
- Before creating anything it queries the Notion database for a page with
  that client's email, and reuses it if one exists. This is the guard against
  the ugly failure mode: page created, Airtable write failed, next cycle
  creates a second dashboard.
- A failure **stops the whole run** rather than continuing to the next client,
  for the same reason.
- Property values are built from Notion's live schema rather than hardcoded,
  so a renamed or missing column is skipped and reported instead of 400-ing
  the request. `Status` is special-cased: Notion's API can't create new
  options on a `status`-type property, so an unrecognised value is dropped
  rather than failing the page.
- `Notion-Version` is pinned to `2025-09-03` in `src/notionClient.js` — the
  version that introduced data sources and the `template` parameter this
  depends on.

## How it works

Airtable's own Automations feature has no "call an external URL" action and no
Discord action — that was checked directly against the automation-builder's
action catalog before writing any code, so this isn't a missed shortcut. Instead,
this server **polls** the Airtable REST API on an interval (default: every 60
seconds) for records created since the last time it checked, and posts to Discord
using a bot. No Airtable-side webhook registration/refresh to maintain, no
Discord-side config beyond inviting the bot.

## One-time setup (do this once, outside Claude Code)

### 1. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_BOT_TOKEN`). Keep "Public Bot" off unless you want it installable elsewhere.
3. Under **Bot Permissions**, the bot only needs **View Channel** and **Send Messages** in each channel it posts to.
4. **OAuth2 → URL Generator**: scope `bot`, permissions `View Channel` + `Send Messages`. Open the generated URL once per server the bot needs to be in (e.g. once for the ops server, again for the client-facing server if the two notification channels live in different servers).
5. In Discord, enable Developer Mode (User Settings → Advanced), then right-click each channel → **Copy Channel ID**. These are `DISCORD_SETTER_EOD_CHANNEL_ID` and `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID`.

### 2. Create the Airtable Personal Access Token

1. [airtable.com/create/tokens](https://airtable.com/create/tokens) → **Create token**.
2. Scope: `data.records:read`, and `data.records:write` too if you're enabling
   new-member onboarding (it writes the matched client's Discord ID back —
   #1-#3 never write, so read-only is fine if that's all you're running).
3. Access: add both the **EOD Reports** base and **The Called — Client Success** base.
4. Copy the token — this is `AIRTABLE_PAT`.

### 3. Deploy the server (Railway or Render)

Either works; pick whichever account you already have.

**Railway:** New Project → Deploy from GitHub repo → select this repo/branch.
Railway auto-detects Node from `package.json` (`npm install`, `npm start`).

**Render:** New → Web Service → connect this repo. `render.yaml` in this repo
pre-fills the build/start commands and health check path — Render will prompt
you for the secret env vars it can't set on its own.

Either way, set these environment variables on the host (see `.env.example` for
the full list with comments):

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | From step 1 |
| `DISCORD_SETTER_EOD_CHANNEL_ID` | Yes | From step 1 |
| `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` | Yes | From step 1 |
| `AIRTABLE_PAT` | Yes | From step 2 |
| `AIRTABLE_EOD_BASE_ID` | No | Defaults to `appO76t48mwkC3j80` |
| `AIRTABLE_CLIENT_SUCCESS_BASE_ID` | No | Defaults to `appkSTSqkeXGHt6pY` |
| `POLL_INTERVAL_MS` | No | Defaults to `60000` (1 minute) |
| `STATE_FILE_PATH` | No | Defaults to `data/state.json` — see caveat below |
| `PORT` | No | Most hosts set this automatically |

Once deployed, `GET /health` returns `{"status":"ok"}` — point the host's health
check at that path (already set in `render.yaml`).

### If Discord posts fail with "Missing Access"

`DiscordAPIError[50001]: Missing Access` in the logs means the bot can't see that
channel — usually because it's a private/locked-down channel and inviting the bot
into the server doesn't automatically grant it access to those. Two ways to fix:

- **Per channel/category:** open the channel or its parent category → Edit →
  Permissions → add the bot (or a role it already has that can see the channel) →
  allow **View Channel** + **Send Messages**.
- **All channels at once:** run `npm run grant-bot-channel-access` (see
  `scripts/grant-bot-channel-access.js`) — a one-time script that grants the bot
  access to every existing channel in every server it's in. On a server that
  locks down permissions per-category, this needs the bot's role to temporarily
  have **Administrator** (Server Settings → Roles → the bot's role) — plain
  "Manage Roles" isn't enough if Manage Roles is itself denied at the
  category/channel level, which is common on locked-down servers. Safe to
  remove Administrator again once the script finishes: it creates an explicit
  per-channel overwrite for the bot, so the access it grants doesn't depend on
  Administrator staying on.

Either way, nothing needs to be redone in Airtable — the poller doesn't advance
its watermark past a record it failed to post, so the next successful poll picks
up any backlogged notifications automatically.

## State persistence caveat

The server needs to remember, per automation, the timestamp of the last record it
already notified about — otherwise every restart would re-post every historical
submission. It keeps this in a small JSON file (`data/state.json` by default),
**not** in Airtable, since neither automation needed a new Airtable field.

On a host without a persistent disk (e.g. Render's free tier), that file resets on
every redeploy. This is safe, not silent duplication: on a reset the server just
treats it as a fresh start and begins watching "from now," so nothing gets
re-posted — but a record created in the few seconds between the last poll before
a restart and the first poll after it could be missed. For a low-volume,
internal-notification use case this is an acceptable tradeoff; if it ever
matters, attach a persistent volume (Render paid plans, Railway volumes) and
point `STATE_FILE_PATH` at it.

## Local development

```bash
npm install
cp .env.example .env   # fill in the real values
npm start               # runs the poller + a small health-check server
npm test                 # unit tests — no live credentials needed
```

## Project layout

```
src/
  config.js            env var loading + validation
  airtableClient.js    Airtable REST API (list + update records)
  discordClient.js     Discord bot login + send-to-channel / DM / create-channel
  state.js             read/write the JSON watermark file
  poller.js            generic "poll -> notify -> advance watermark" loop
  automations/
    setterEod.js        Setter EOD -> Discord message
    weeklyCheckin.js     Weekly Check-in -> Discord message
  reminders/
    weeklyCheckinReminder.js       who gets a reminder DM, and the message
    schedule.js                     DST-aware "is it Friday at HH:MM ET" helpers
    sendWeeklyCheckinReminders.js   the real send path
  notionClient.js      Notion REST API (data sources, templates, create page)
  dashboards/
    clientDashboard.js           field mapping + who needs a dashboard (pure)
    createClientDashboards.js    the real create/write-back path
  onboarding/
    channelName.js       display name -> Discord-safe channel name
    email.js              email-shaped-text detection + normalization
    welcomeMessage.js     the welcome message template
    newMemberOnboarding.js  wires the Discord join/reply event listeners
  index.js              wires it all together, starts the poller + express server
test/                  unit tests (node:test, no network calls)
docs/
  Automation_Hub_Blueprint.md   the original blueprint this hub implements
  STATUS.md                     what's built vs. pending, and why
```

To add a future automation onto this same server, add a module under
`src/automations/` exporting `key`, `tableId`, and `formatMessage(record)`, then
register it in the `automations` array in `src/index.js`.
