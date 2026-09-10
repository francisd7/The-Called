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
| New-member onboarding | Someone joins the client-facing Discord server (`DISCORD_CLIENT_GUILD_ID`) | Works out which package invite they used, assigns the matching brand + tier roles, creates a private `firstname-lastname` channel under that tier's category (visible to them, the bot, and the staff that tier is entitled to), posts the welcome message, then waits for their reply. A reply that looks like an email is matched against the Clients table's `Email` field — matched → writes their Discord ID back to that record; no match (the common case for a genuinely new signup) → creates a starter Client record (Name, Email, Discord ID, Start Date, Status Active, plus Brand and Package/Tier from the invite) and flags `DISCORD_ONBOARDING_FLAG_CHANNEL_ID` so staff fills in CSM and Contract Value. |
| Tier sync | A tier role is added or removed on a member in the client server | Writes the new `Package / Tier` to the matching Client record, moves their private channel to the new tier's category (rewriting its permission overwrites so the new tier's staff actually gain access), and posts the change to `DISCORD_TIER_CHANGES_CHANNEL_ID` as an audit trail. |

The first two notifications go to separate Discord channels (and can be in
separate servers) — the bot just needs to be a member of whichever server
each channel lives in. First four automations are live as of 2026-09-09;
tier sync is built but gated off by default (see below).

## Discord server structure

The client server's roles, categories, channels and permissions are defined
as data in [`src/discord/serverStructure.js`](src/discord/serverStructure.js),
and reconciled onto Discord by `npm run discord-structure`. **Edit that file,
never the server by hand** — otherwise the two drift and the next run fights
you.

Channel names in the live server carry decorative emoji and separators, so
`🌐│welcome` is the real name of what the config calls `welcome`. The apply
script matches exactly first, then on the name with emoji and punctuation
stripped, and reports every loose match it makes. Without that it would
report every existing channel as missing and create a duplicate of each — the
first real dry run caught exactly that. New channels are still created with
the plain name from the config; existing ones keep whatever styling they
have.

Three layers of access, each answering a different question:

| Layer | Who reaches it | What lives there |
|---|---|---|
| `WELCOME` | everyone | orientation |
| `THE CALLED` | everyone, payers and not | community and faith |
| `THE FORGE` | every paying tier | the shared work |
| `TRAINING HUB` | Momentum and up | sales, setting, and the weekly call |
| `FOUNDATIONS` / `MOMENTUM` / `INNER CIRCLE` | one tier each | that tier's own |
| `VETERANS` | past clients | somewhere to stay |

THE FORGE is the layer that stops every shared work channel being duplicated
three times across the tier categories.

Two axes, deliberately separate. **Brand** says which product line someone
bought into (`Called Coaches`, `Called Creators`, `The Called`) and is purely
a label. **Tier** is what gates access, and what it buys is how much of the
team you get:

| Tier | Price | Private channel | Who else is in it |
|---|---|---|---|
| The Called | $1,000 | none — the shared THE CALLED section is everything | — |
| Foundations | $3k/3mo or $5k/6mo | ✓ | CSM, COO |
| Momentum | $10k one-time or $12k split | ✓ | CSM, CMO, Nigel, COO |
| Inner Circle | $20k | ✓ | CSM, CMO, Nigel, COO |

Foundations deliberately excludes the CMO and Nigel — they only service the
top two tiers, and the tier categories are what make that legible at a glance
instead of a mental note. TRAINING HUB opens at Momentum, for both brands.

**Each tier's category is that tier's whole home** — `#<tier>-announcements`
(staff post, clients read), `#<tier>-chat`, and that tier's private client
channels underneath. Before this there was nowhere to tell every Momentum
client something without messaging the whole server.

**Brand is a role, not a category.** Course content is delivered in each
client's private channel, so the per-brand categories had nothing left worth
splitting and their channels moved into THE FORGE. `Called Coaches` and
`Called Creators` survive as hoisted, colored roles — they identify someone
in a mixed channel and are the @-mention target for a brand-wide
announcement — but they gate nothing. Per-tier conversation happens in each
tier's own `#<tier>-chat`, and one `#the-forge-chat` covers everyone paying.

**`Coach`** reaches every category, including the tier ones, but never a
private client channel — those are built from each tier's `staffRoleNames` in
`tiers.js`, which deliberately omits it. It carries `ManageEvents` for the
weekly call. It replaces both the old `Eddie` and `Ops Team` roles, which
wanted the same thing: everything staff see, minus the private client chats.
Whoever holds it can separately hold a `Tier:` role as a client; the two
compose rather than needing a special case.

**`Nigel`** stands in for what would otherwise be a `Founder` role — the role
already exists and is integration-managed, so it can't be renamed.

**Veterans** are past clients with lifetime community access. `Veteran` is a
role, not a tier — nobody is paying for it, so giving them a tier role would
make tier sync write a package onto a Completed/Cancelled record. It grants
THE CALLED, the VETERANS section, and read-only `#wins`. Losing the paid
areas is the point: seeing `#wins` without being able to reach what produced
them is what brings someone back.

**`#wins` lives in THE FORGE**, a paid category, but the bible-study tier and
veterans are granted on that one channel. This works because Discord resolves
a channel against its *own* overwrites, never its category's — the category's
are only a default for channels synced to it. So an unpaid member sees THE
FORGE in their sidebar containing `#wins` and nothing else. They read what
the paid tiers produce; they can't reach what produced it, or post into it.

**Every channel name is unique across the server**, and a test enforces it.
Each recording channel says what it records — `#bible-study-recordings`,
`#masterclass-recordings`, `#training-recordings`. Warrior Huddles
aren't recorded, bible study is, hence one channel in THE CALLED rather than
a catch-all.

**TRAINING HUB** is everything taught to the top two tiers in one place:
sales, setting, and Eddie's weekly call. Framing it as training rather than
as two disciplines is what let a Momentum-only recordings channel go away —
the weekly call had been sitting in a tier category for want of anywhere
else, which left Inner Circle without it and broke the rule that a higher
tier reaches everything a lower one does. `#convo-reviews` stays separate,
because a DM thread gets picked apart line by line and that isn't what a
recording drop is for.

`visibleChannelsFor(role)` in the structure config answers "what will a
Foundations client actually see?" — the check worth running before applying
anything, and one you can't do by reading the config, since the answer turns
on Discord judging a channel by its own overwrites rather than its
category's. Tests use it to pin the two properties that matter: the unpaid
tiers reach `#wins` and nothing else in THE FORGE, and every tier reaches a
superset of the tier below it.

Pods are no longer used, so the config declares nothing about them. The apply
script never deletes, so the existing pod channels stay untouched in Discord
until someone archives them by hand. Same for the old `#course-content` and
per-brand channels — dropped from the config, left alone in Discord.

### Rolling it out

Three scripts, all dry-run by default and all additive — none ever deletes a
role, a channel or a category, because a wrong delete costs real client
history and there is no undo. Run them in this order; each depends on the one
before it.

```
npm run discord-structure                 # plan the roles/categories/channels
npm run discord-structure -- --apply
npm run grant-bot-channel-access          # new categories lock the bot out
npm run discord-structure -- --apply --invites   # prints the invite map
npm run discord-migrate-roles             # plan the role assignments
npm run discord-migrate-roles -- --apply
npm run discord-migrate-channels          # plan the private-channel moves
npm run discord-migrate-channels -- --apply
```

`discord-migrate-roles` is the one-time pass that gets everyone already in
the server onto the new roles: brand + tier for anyone matched in Airtable by
`Discord ID`, and `Veteran` for anyone holding a legacy client role who isn't
in Airtable at all. **This is the only time Airtable seeds Discord** — after
it the direction reverses permanently.

That `Veteran` fallback matters more than it sounds: access is deny-by-default
and every category is gated on a `Tier:` role or `Veteran`, so anyone the
migration doesn't touch sees only WELCOME. `Called Coaches` alone has 79
members against 13 active clients.

Two cases it deliberately refuses to guess: a member in Airtable with no
`Package / Tier` recorded (demoting them to `Veteran` would strip a paying
client; inventing a tier would fabricate a sale), and staff, who service
clients rather than being one. Both are listed as skipped for a human.

`discord-migrate-channels` is the last step, and the one that actually fixes
the problem this restructure exists for: the private client channels sat in a
flat list where nobody could tell which were the CMO's and Nigel's. It moves
each active client's channel into their tier's category **and rewrites its
permission overwrites** to that tier's staff list.

Both halves are required. Dragging a channel into `MOMENTUM` by hand changes
nothing about who can see it — a private client channel carries an overwrite
the category cannot (the client's own access), which desyncs it by
definition, and Discord resolves an unsynced channel against its own
overwrite list only, never its category's. The by-hand version of this looks
finished and leaves the CMO exactly as locked out as before.

It finds a client's channel by their permission overwrite rather than by
name — names are stale display names and a rename would strand the channel —
and it will not touch a channel it isn't sure about. No match, two matches, a
missing role or a missing category each leave the channel exactly as it is
and print a line for a human. It rewrites the overwrite list outright, so the
dry run also prints, by name, every overwrite each rewrite would drop, plus
any undeclared channel carrying a personal grant that no active client
claimed (mostly past clients — reported, never touched).

Four things the scripts can't do, in Server Settings afterwards:

1. Move the bot's role above `Called Coaches` so it can assign roles.
2. Turn `@everyone` → View Channel **off** at the server level.
3. Give the bot **Manage Roles** and **Manage Guild**.
4. Rename anything the config renamed — see `docs/STATUS.md`. The scripts
   never rename, so a renamed channel is created empty alongside the original
   and the history is stranded.

### Where the bot's output goes

Everything the bot needs a human to look at — onboarding flags it couldn't
resolve, and the tier-change audit log — posts to
`DISCORD_OPS_NOTIFICATIONS_CHANNEL_ID` in the **ops server**, not the client
server. Staff work there, clients are here, and splitting bot output across
both would mean watching two places. The EOD feed already lives there too.

**The bot has to be a member of the ops server** for any of this to send.
`DISCORD_ONBOARDING_FLAG_CHANNEL_ID` and `DISCORD_TIER_CHANGES_CHANNEL_ID`
both default to that channel and can be split out later if the audit log
wants its own.

The client server has **no staff category at all** — staff work in the ops
server, and a staff chat here would have been one more place to watch.

### One thing tier sync deliberately will not do

Removing someone's tier role — the normal path when a client finishes and
becomes a Veteran — **does not blank their `Package / Tier` in Airtable.**
Losing Discord access doesn't un-buy the program, and blanking it would
destroy the record of what they actually paid for. The change is logged with
a note saying the tier was left alone; `Status` is what should change, and
tier sync never touches that.

Two things worth knowing before touching permissions:

- **`@everyone` has View Channel off at the server level.** Access is opt-in
  per category, so a channel added later is invisible until something grants
  it. That is the fix for clients seeing areas they never bought.
- **A client's private channel is never synced to its category.** It carries
  one overwrite the category can't (the client's own access), which desyncs it
  by definition — and Discord does not consult a category's overwrites for an
  unsynced channel. So the overwrite list has to be self-contained, and
  moving a channel between tier categories changes nothing about who can see
  it unless the overwrites are rewritten too. `tierSync` does both. **Never
  click "Sync Now" on a client channel** — it wipes the client's own access.

`Package / Tier` in Airtable was renamed from Entry/Mid/High to these names,
keeping the old label in a parenthetical while the team gets used to them —
so the live options read `Momentum (Mid)`, `Foundations (Entry)`, and so on.
Reads ignore that parenthetical, so dropping it later changes nothing;
**writes use the exact option name**, so the four `airtableValue` strings in
[`src/discord/tiers.js`](src/discord/tiers.js) are coupled to the base and
need updating if those options are renamed again.

Price is recorded in `Contract Value`, never derived from it — payment plans,
discounts and clients grandfathered in from before a program change all mean
price does not cleanly separate the tiers.

## Invite-link routing

Discord has no native "this invite grants this role" feature, so the bot
infers it: it keeps every invite's use count, and when someone joins it
re-fetches and finds the one that went up. One permanent invite per package,
seven in total (bible study, plus each paid tier × each brand). Send the buyer
the link for what they bought and they land with the right roles, the right
channel, in the right category, with no manual sorting.

Generate the invites and the env var line in one step:

```
node scripts/apply-discord-structure.js --apply --invites
```

It prints a `DISCORD_INVITE_ROLE_MAP` value to paste onto the host. That map
lives in an env var rather than `data/state.json` on purpose — state.json
resets on hosts without a persistent disk, and losing the map would quietly
drop every new joiner to no tier at all.

Because it is inference, it can be wrong, so every uncertain case grants
nothing and flags `DISCORD_ONBOARDING_FLAG_CHANNEL_ID` rather than guessing a
tier upward:

| Case | What happens |
|---|---|
| Bot was down during the join | No baseline to diff. Channel and welcome still happen, no tier role, flagged. |
| Two people join at once | Ambiguous. No tier role, flagged. |
| Vanity URL or server widget | No invite diff at all. No tier role, flagged. |
| An invite that isn't in the map | Flagged by code, so it can be added. |
| A forwarded link | The email-reply step cross-checks the invite's tier against the matched Client record and flags a mismatch. Tightening this further means one-time invites generated per purchase from a Whop webhook — deferred, see `docs/STATUS.md`. |

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
