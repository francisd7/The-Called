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

The two notifications go to separate Discord channels (and can be in separate
servers) — the bot just needs to be a member of whichever server each channel
lives in.

Both are pure notifications: no branching, no new Airtable fields, nothing to
match.

## Weekly Check-in reminder DMs (#3) — built, gated off by default

Every Friday at a configurable time (default noon ET), DMs every `Status =
Active` client with a Discord ID on file: "Hey [First Name], time for your
Weekly Check-in — [prefilled link]". Two independent skip conditions, both
logged in a run summary posted to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID`, not
failed silently:

- **`Discord ID`** blank on the Clients table (`The Called — Client Success`
  base) → skipped until it's filled in.
- **`Skip Weekly Reminder`** checked on the same table → permanently
  skipped even once a Discord ID exists (e.g. once the future new-member
  onboarding automation starts auto-populating Discord ID for other
  reasons) — this always wins over having a Discord ID.

**This does not send real DMs until you explicitly turn it on.** Set these
env vars on the host to go live:

| Variable | Required to go live | Notes |
|---|---|---|
| `WEEKLY_REMINDER_ENABLED` | Yes | Must be exactly `true` (string). This is the on/off switch — everything else about #3 already exists in code either way. |
| `WEEKLY_REMINDER_HOUR_ET` | No | Defaults to `12` (noon). 24-hour, America/New_York (handles EST/EDT automatically). |
| `WEEKLY_REMINDER_MINUTE_ET` | No | Defaults to `0`. |

Before flipping that switch, you can still dry-run it as many times as you
want with `scripts/run-weekly-checkin-reminder-dry-run.js` — it has no code
path that can send a real DM, and posts to a test channel instead:
```
npm run weekly-reminder-dry-run
```
(needs `DISCORD_BOT_TOKEN`, `AIRTABLE_PAT`, and `DISCORD_TEST_CHANNEL_ID` set,
e.g. in a local `.env`)

Not built yet at all: the new-member onboarding flow (#4 in the blueprint) —
blocked on onboarding message copy from a human. See `docs/STATUS.md` for
full status.

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
2. Scope: `data.records:read` only — this server never writes to Airtable.
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
  airtableClient.js    Airtable REST API (list records created after a timestamp)
  discordClient.js     Discord bot login + "send message to channel"
  state.js             read/write the JSON watermark file
  poller.js            generic "poll -> notify -> advance watermark" loop
  automations/
    setterEod.js        Setter EOD -> Discord message
    weeklyCheckin.js     Weekly Check-in -> Discord message
  index.js              wires it all together, starts the poller + express server
test/                  unit tests (node:test, no network calls)
docs/
  Automation_Hub_Blueprint.md   the original blueprint this hub implements
  STATUS.md                     what's built vs. pending, and why
```

To add a future automation onto this same server, add a module under
`src/automations/` exporting `key`, `tableId`, and `formatMessage(record)`, then
register it in the `automations` array in `src/index.js`.
