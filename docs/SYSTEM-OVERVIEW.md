# The Called — how the Discord and the automations work

Context document for an AI assistant. Describes the system as it stands after
the Discord restructure went live on 2026-09-10. Everything here is current
unless marked otherwise.

Repo: `francisd7/The-Called`, branch `claude/pensive-ride-by371v`. **There is
no `main` branch** — that branch is the deployed one. Node.js, ESM,
discord.js v14, `node:test`, hosted on Railway.

---

## 1. The business

The Called sells business coaching to Christian men, under two product lines
plus a community tier.

**Team and their Discord roles:**

| Person | Role | What they do |
|---|---|---|
| Nigel | `Nigel` | Founder |
| Francis | `COO` | Operations. Owns these systems |
| Andrew | `CMO` | Marketing. Services the top two tiers only |
| Noah | `CSM` | Client success. In every client's private channel |
| Eddie | `Coach` | Runs a weekly call. Also an Inner Circle client himself |

`Coach` is a general staff role — everything staff see **except** private
client channels. It replaced a person-specific `Eddie` role and absorbed the
old `Ops Team` role.

**Two servers.** The *client server* is where clients live. A separate *ops
server* is where staff work and where all bot output goes — audit logs,
onboarding flags, EOD and check-in feeds. Bot notifications deliberately do
not go to the client server.

---

## 2. The tier ladder

Tier is **what someone bought**, and it is the thing that gates access. Brand
and tier are separate axes: brand decides which content line you're in, tier
decides how much of the team you get. An upsell changes tier, never brand.

| Tier | Price | Private channel | Staff in that channel |
|---|---|---|---|
| **The Called** | $1,000 | No | — |
| **Foundations** | $3k/3mo or $5k/6mo | Yes | CSM, COO |
| **Momentum** | $10k once or $12k split | Yes | CSM, CMO, Nigel, COO |
| **Inner Circle** | $20k | Yes | CSM, CMO, Nigel, COO |

The CMO and Nigel are deliberately absent from Foundations channels — they
only service the top two tiers. That single fact is why the whole restructure
happened: 19 private channels used to sit in one flat list and nobody could
tell which were theirs.

**Brands:** `Called Coaches`, `Called Creators`, and `The Called` (the
community-only brand, bible study members).

**Client counts at restructure:** 8 Foundations, 10 Momentum, 1 Inner Circle,
3 The Called. Plus Wylie Hawkins — $20k for six months of 1:1 calls with
Nigel, serviced entirely outside Discord, no Discord account. He is not a
missing Inner Circle member.

Names were chosen to describe the program rather than the price ladder. Avoid
suggesting names like "Entry / Mid / High", and avoid surfacing prices or tier
rank in anything client-facing — a chat that reads as a ranking stops the
people at the bottom of it from posting.

---

## 3. Discord structure

Eight categories. The server is **deny-by-default**: `@everyone` has View
Channels off at the server level, so a new channel is invisible until
something grants it.

```
WELCOME              everyone, read-only
  #welcome  #start-here  #announcements  #book-1-1

THE CALLED           all tiers + Veterans
  #general-chat  #bible-study  #bible-study-recordings  🔊 Warrior Huddle

THE FORGE            Foundations and up
  #the-forge-chat  #content-review  #reel-ideas  #wins
  #masterclass-recordings  🔊 build session

TRAINING HUB         Momentum and up
  #sales-general  #setting-general  #convo-reviews  #training-recordings

FOUNDATIONS          Tier: Foundations + CSM, COO, Coach
  #foundations-announcements  #foundations-chat  + 8 private client channels

MOMENTUM             Tier: Momentum + CSM, CMO, Nigel, COO, Coach
  #momentum-announcements  #momentum-chat  + 10 private client channels

INNER CIRCLE         Tier: Inner Circle + CSM, CMO, Nigel, COO, Coach
  #inner-circle-announcements  #inner-circle-chat  + 1 private client channel

VETERANS             Veteran role
  #veterans-chat
```

Plus a `Retired Channels` category, admin-only, holding dead channels.

**`#wins` is the upsell surface.** It sits inside THE FORGE, which unpaid
tiers can't reach — but it carries its own overwrite granting `Tier: The
Called` and `Veteran` read-only access. So they see THE FORGE containing that
one channel and nothing else. They read what the paid tiers produce and can't
reach what produced it. This is deliberate and is the mechanism behind
"everyone sees wins".

**Roles (16), in hierarchy order:** `Nigel`, `COO`, `CMO`, `CSM`, `Coach` →
the bot → `Called Coaches`, `Called Creators`, `The Called` → `Consistent
Clients`, `First Client Closed`, `Offer Built` → `Veteran` → the four `Tier:`
roles.

The bot's role must sit above every role it assigns. Administrator does not
bypass that.

`Tier:` roles are uncoloured and never hoisted — they gate access without
showing clients what anyone paid. The achievement roles carry the visible
aspirational signal instead.

`Veteran` is past clients with lifetime community access — THE CALLED plus
read-only `#wins`. It is not a tier: a veteran isn't paying for anything, so
giving them a `Tier:` role would make the sync write a package onto a
closed record. Roughly 57 people hold it.

---

## 4. The permission rule that governs everything

**A channel is judged on its own overwrite list, never its category's.** The
category's list is only a default for channels *synced* to it.

Two consequences that have each cost a wasted round trip:

1. **A private client channel can never be synced** — it carries the client's
   own grant, which desyncs it by definition. So moving one between tier
   categories changes *nothing* about who can see it. Every move must rewrite
   the overwrites too. Dragging channels by hand looks finished and leaves the
   CMO exactly as locked out as before.
2. **The same rule in reverse when retiring.** Dragging a channel into a
   locked category does not hide it if that channel carries its own
   overwrites. It needs syncing — safe on a dead channel, destructive on a
   client's, because it would wipe their access to their own channel.

Also: every new category locks the bot out and needs
`npm run grant-bot-channel-access` after.

---

## 5. Automations

All run in one always-on Node service on Railway. Each is gated by an
environment variable that must be the literal string `"true"` — the gate
between "code exists" and "real people get real messages".

| # | Automation | Trigger | Gate | Output |
|---|---|---|---|---|
| 1 | Setter EOD → Discord | Polls Airtable every 60s | always on | `DISCORD_SETTER_EOD_CHANNEL_ID` |
| 2 | Weekly Check-in → Discord | Polls Airtable every 60s | always on | `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` |
| 3 | Weekly Check-in reminder | Scheduled, Friday noon ET | `WEEKLY_REMINDER_ENABLED` | A post in each client's own private channel |
| 4 | New-member onboarding | `guildMemberAdd` | `NEW_MEMBER_ONBOARDING_ENABLED` | Roles, a private channel, an Airtable record |
| 5 | Tier sync | `guildMemberUpdate` | `TIER_SYNC_ENABLED` | Airtable write, channel move, audit log |
| 6 | Weekly Check-in missing report | Scheduled, Saturday noon ET | `WEEKLY_REPORT_ENABLED` | Staff channel post naming who didn't check in |
| 7 | Post Call → Discord | Polls Airtable every 60s | `DISCORD_POST_CALL_CHANNEL_ID` set | Full call outcome, attribution, money and recording |

**#1–#5 and #7 are live.** #1–#5 since 2026-09-10; #7 since 2026-09-11,
verified end-to-end with a test record that posted and was then deleted.
**#6 is built but off** until `WEEKLY_REPORT_ENABLED` is set.

**#3** posts into each client's private channel rather than DMing them —
changed 2026-09-11 after the first live run, where 20 DMs sent successfully and
nobody noticed, because a DM lands in an inbox nobody opens and the CSM never
sees it. The client's channel is where their coaching already happens, it is
private to them and their CSM, and Noah can tell at a glance who was asked.
The client is mentioned rather than named, so they still get the notification
the DM gave them. A client with no private channel is reported, never quietly
DMed instead — that fallback would hide the gap worth fixing. It skips anyone
with `Skip Weekly Reminder` checked, and only targets `Status = 'Active'`.

**#7** posts the outcome of a sales call as soon as a closer logs it. Unlike
the EOD automations, which announce that a daily summary was submitted, this
carries the whole record — outcome, who closed it, which setter booked it,
cash and revenue, notes and the Fathom link — because the call *is* the event.
The outcome leads with its own icon so a channel of these reads at a glance,
and the money line is omitted when a call produced none: a row of "$0
collected" teaches people to skip the line that matters. It has no boolean
gate; the channel id is the switch.

**#6** is the accountability half of #3. The Friday DM used to go out and
nothing followed, so a client could quietly stop checking in for a month and
the first anyone noticed was at renewal. The report names who didn't submit,
grouped by CSM — a flat list of fourteen names gets skimmed by everyone and
owned by no one. It counts a **whole week** of check-ins, not just the hours
since the DM: people submit before being asked, and both check-ins on file when
this was built arrived the evening before that week's reminder. Matching is on
the check-in's linked record ID, so a renamed client is never a false miss.

**A brand-new client is expected to check in like everyone else.** That is a
deliberate call: their first check-in is the baseline their CSM reads before
the onboarding call, so excusing them would withhold the most useful one.
`WEEKLY_REPORT_GRACE_DAYS` defaults to 0 and can be raised to excuse recent
joiners if the report ever gets noisy — it compares against `Start Date`, so
the excuse lapses on its own. At 0 it still excludes anyone whose start date is
in the future, since they have no week to have missed. Never use
`Skip Weekly Reminder` to silence someone temporarily: that flag is permanent
until a human clears it, and nobody ever does.

**#4, invite routing.** Discord has no native invite→role mapping. **Four**
permanent invite links exist, one per tier. The bot caches every invite's use
count and, on a join, finds which one incremented.
`DISCORD_INVITE_ROLE_MAP` holds `code=slot` pairs. That map lives in an
environment variable, not on disk, because losing it would silently drop every
new joiner to no tier.

It was seven — each paid tier crossed with each brand — until 2026-09-11.
Brand gates nothing since the brand categories were deleted, so routing on it
doubled the list the team picks from for no entitlement, and with seven rows a
mis-pick could land on the wrong **tier**, which does gate access and does
touch billing. A paid client's `Called Coaches` / `Called Creators` role is now
assigned by hand, and `Brand` is left blank on the starter record for the CSM
to fill. The bible-study link still carries its brand, because that tier has
exactly one.

Every ambiguous case grants nothing and flags a human — a join while the bot
was down, two simultaneous joins, a vanity URL. It never guesses upward.

**#5, tier sync.** Adding or changing a `Tier:` role on a member causes the
bot to write `Package / Tier` to their Airtable record, move their private
channel into the new tier's category, rewrite that channel's overwrites to the
new staff list, and post the change to the ops channel.

**Tier sync has no catch-up.** It listens on that one event and nothing else,
so a role clicked while the bot is down or redeploying is lost permanently —
no retry, no queue. This happened on 2026-09-10 and nothing surfaced it.
`npm run tier-reconcile` is the manual catch-up; run it after a deploy.

One deliberate exception: **removing** a tier role writes nothing to Airtable.
Losing the role means losing access, not un-buying the program — a client
finishing and becoming a Veteran is the normal path. Blanking `Package / Tier`
would destroy the record of what they paid for.

---

## 6. Direction of truth

**Discord leads, Airtable follows.** The tier role is what actually gates
access, so it is the authoritative record of what someone bought. When staff
move a client up a tier in Discord, that is written back to Airtable — never
the reverse.

The one exception is the initial migration, which seeded Discord roles from
Airtable. That happened once and the direction is now permanently reversed.

**Every write is announced in the ops channel.** That audit trail is what
makes "Discord wins" safe: a mis-clicked role rewrites a billing field, and
without a log nobody would notice until renewal. Muting that channel removes
the only safeguard on this design.

At onboarding specifically, the invite link decides tier and a join-time
mismatch against Airtable is flagged for a human rather than resolved
automatically.

---

## 7. Airtable

Base `appkSTSqkeXGHt6pY` (Client Success), table `Clients` /
`tblrIOcPpSfDQaHfj`. Fields that matter: `Client Name`, `Discord ID`, `Brand`,
`Package / Tier`, `CSM`, `Status`, `Contract Value`, `Journey Stage`,
`Skip Weekly Reminder`, `Email`.

Other tables: Weekly Check-in `tblj04VfjlFxoXzL6` (same base). In the EOD
Reports base `appO76t48mwkC3j80`: Setter EOD `tblAOPJioGyBRliH4`, Post Call
`tblbMVKMdrdgy9RZq`, and two that nothing reads yet — Dialler EOD
`tbluLQ0gHGTxy73o4` and CSM EOD `tbli3kSDQR06MsKKC`.

`Package / Tier` options currently keep the old name in parentheses —
`Momentum (Mid)`, `Foundations (Entry)`, and so on. Reads ignore the
parenthetical, so dropping it later is a four-string change in
`src/discord/tiers.js`. **Writes must use the exact option name**, because
Airtable rejects a value that isn't already an option.

Tiers do not track price cleanly — payment arrangements and timing vary, so
`Contract Value` spans a wide range within a tier. Tier comes from the
purchase, not from the contract value.

---

## 8. Admin scripts

All dry-run by default, all additive — none deletes a role, channel or
category. Run in this order; each depends on the one before.

```
npm run discord-structure          # reconcile roles/categories/channels
npm run grant-bot-channel-access   # new categories lock the bot out
npm run discord-structure -- --apply --invites   # creates the 4 invites
npm run discord-migrate-roles      # brand + tier roles from Airtable (one time)
npm run discord-migrate-channels   # client channels into tier categories
npm run discord-sync-retired       # make retiring a channel actually hide it
npm run tier-reconcile             # catch tier changes tier sync missed
npm run weekly-report-dry-run      # preview Saturday's missing-check-in report
npm run weekly-reminder-dry-run
```

Add `-- --apply` to write. `src/discord/serverStructure.js` is the source of
truth for the server — edit that file, never the server by hand, or the two
drift and the next run fights you.

`src/discord/tiers.js` is the source of truth for the ladder. Add a tier there
and the structure config, invite map and sync logic all pick it up.

---

## 9. Known state and gotchas

- **State persistence.** Polling watermarks live in `data/state.json` on
  Railway's ephemeral disk, so every deploy resets them and roughly one to
  three minutes of submissions are skipped, silently. The fix is a Railway
  volume mounted at `/data` plus `STATE_FILE_PATH=/data/state.json`. Check
  whether this has been done before assuming feeds are lossless.
- **Live category names may carry emoji.** All lookups normalize past
  decoration and punctuation. Never add an exact-string name match.
- **`brands.js` still carries `categoryName` for the two brand categories.**
  Those categories no longer exist — brand is now purely a role. The field is
  only read to decide which brands get invite slots, so it is harmless, but
  don't treat it as evidence those categories exist.
- **Pods are retired.** `#pod-1-chat` etc. are dead and deliberately absent
  from the structure config.
- **`SETTING MANAGER`** is an integration-managed role, one member, left
  alone on purpose.
- **The Whop Bot does nothing.** Confirmed 2026-09-09. Wiring it up to issue
  one-time purchase-scoped invites is a genuine future option, not a current
  behaviour.

---

## 10. Working preferences on this project

- Prefer scripting a repetitive Discord operation over doing it by hand.
  Anything touching permissions on more than two channels should be a script
  with a dry run, because the by-hand version is where a client gets locked
  out of their own channel.
- Any script that changes permissions should refuse to act on anything
  ambiguous and print it for a human instead of guessing.
- Never suggest "Sync Now" on a private client channel.
- Secrets live in Railway. Never ask for a bot token or paste invite codes
  into a chat — invite codes have had to be rotated once already for this
  reason.
