# Automation Hub — Build Status

Tracks progress against the build priority in `Automation_Hub_Blueprint.md`.

| # | Automation | Status | Notes |
|---|---|---|---|
| 1 | Setter EOD → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Setter EOD submission posted to `DISCORD_SETTER_EOD_CHANNEL_ID`. |
| 2 | Weekly Check-in → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Weekly Check-in submission posted to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` (a separate channel/server from #1, at the user's request). |
| 3 | Discord ID field + Friday reminder DMs | ✅ Live | `WEEKLY_REMINDER_ENABLED=true` set on Railway and confirmed on 2026-09-09; deployment stable. First real send: Friday 2026-09-11, 12:00 PM ET (`America/New_York`, DST-aware). 19 of 22 active clients backfilled with a Discord ID; Wylie Hawkins, Malachi Hardware, Patric Cocos have `Skip Weekly Reminder` checked (bible-study-only clients, no personal-branding access, confirmed with the user). Message: "Hey [First Name], time for your Weekly Check-in — [link]". Dry-run path (`npm run weekly-reminder-dry-run`) still available for testing future changes without risk. |
| 4 | New-member onboarding flow | ✅ Live | Enabled on Railway and verified end-to-end on 2026-09-09 with a real test-account join: channel creation, permissions, welcome message (mentions rendering correctly), and the no-match path were confirmed working via a real join in the client server. Design went through two iterations after that first live test: (1) no-match originally just flagged staff and waited — the user pointed out a new signup's Airtable record essentially never exists yet at join time, so that path would have fired for almost every real new member; (2) briefly fixed with a retry-on-poll-cycle mechanism, then the user clarified they actually wanted the automation to create the starter Client record itself (Name, Email, Discord ID, Start Date, Status Active) rather than wait on staff — so it does that now, and the retry mechanism was removed as unnecessary. Flag channel is a dedicated channel (`DISCORD_ONBOARDING_FLAG_CHANNEL_ID`), not the Weekly Check-in channel, per the user's request after seeing the first test flag land there. Team "new member joined" notification explicitly dropped per the user — they want a separate Whop-based notification with purchase amount instead (not built). Status `Active` on the starter record was a deliberate choice, confirmed with the user, even though it makes the client immediately eligible for automation #3's Friday reminder before a CSM is assigned. |
| 5 | Discord restructure: roles, tier categories, invite routing | 🔨 Built, not applied | Blueprint approved. `src/discord/serverStructure.js` defines 16 roles, 8 categories and 24 declared channels; `scripts/apply-discord-structure.js` reconciles them (dry-run by default, additive only, never deletes). Invite-link routing and tier sync are wired but `TIER_SYNC_ENABLED` is off. **Nothing has been applied to the live server yet.** The Whop blocker cleared on 2026-09-09; see the decisions and open items below. |

### #5 — decisions settled with the user

- **The Whop Bot does nothing.** Confirmed 2026-09-09. It is not a second
  writer to the tier roles, so it no longer blocks the restructure. Whether
  to wire it up for one-time purchase-scoped invites is still a genuine
  follow-up, not scoped here.
- **Airtable renamed**, keeping the old label in a parenthetical:
  `The Called (Bible Study & Warrior Huddles)`, `Foundations (Entry)`,
  `Momentum (Mid)`, `Inner Circle (High)`. `getTierByAirtableValue` strips a
  trailing parenthetical, so reads survive a later cleanup; **writes use the
  exact option name**, so the four `airtableValue` strings in
  `src/discord/tiers.js` are coupled to the base and need updating if those
  options are renamed again.
- **The four off-price Momentum clients stay in Momentum.** Luke Buscher
  ($100), Nick Martinez ($1,500), Alexandra Urbina ($1,500), Isaac Gonzalez
  ($4,500) were part of Momentum before the program changed and keep that
  access — a deliberate grandfathering decision, not stale data. Confirms
  again that tier must never be derived from `Contract Value`.
- **Pods are dead.** The config declares nothing about them; the apply script
  never deletes, so the existing pod channels stay in Discord until someone
  archives them by hand.
- **The 💪 section is now `Veteran`** — past clients with lifetime community
  access to THE CALLED plus the VETERANS section, and nothing else. Named Veteran
  rather than Alumni because a badge sitting next to paying clients in #wins
  should read as "been through it", not "former customer". It is deliberately
  *not* a tier role: nobody is paying for it, so a tier role would make tier
  sync write a package onto a Completed/Cancelled record. `#wins` is
  read-only for them, which is the whole re-enrolment mechanic — they see
  what is happening and cannot reach what produced it.
- **SETTING and SALES open at Momentum, for both brands** — not coaches-only.
- **Course content is dropped entirely** — it hadn't been used in a while and
  clients get their material in their private channels. That removed the only
  reason the per-brand categories existed, so `CALLED COACHES` and
  `CALLED CREATORS` are gone and their work channels moved into THE FORGE.
- **Brand is now a role, not a category.** `Called Coaches` / `Called
  Creators` stay hoisted and colored so staff can tell who is who in a mixed
  channel, and they are the @-mention target for a brand-wide announcement,
  but they gate nothing.
- **Three tier categories, each that tier's whole home**: `FOUNDATIONS`,
  `MOMENTUM`, `INNER CIRCLE` (the `CLIENTS · ` prefix is gone), each with
  `#<tier>-announcements`, `#<tier>-chat`, and that tier's private channels.
  The announcements channel closes a real gap — there was previously no way
  to reach one tier without messaging the whole server.
- **No `STAFF` category** — staff work in the ops server, where the bot's
  output already goes, so a staff chat here was one more place to watch.
- **`SALES & SETTING` became `TRAINING HUB`** and absorbed Eddie's weekly
  call. That resolved the open question about `#momentum-recordings`: the
  call had been put in a tier category for want of anywhere else, which left
  Inner Circle without it and broke the rule that a higher tier reaches
  everything a lower one does. A test now pins that rule across the ladder.
- **`visibleChannelsFor(role)`** resolves what a role actually sees, applying
  Discord's real rule that a channel is judged on its own overwrites rather
  than its category's. Tests use it to pin the unpaid tiers to `#wins` alone
  within THE FORGE.
- **`#💪-chat` is now `#veterans-chat`**, matching the tier chats, and the
  category is plain `VETERANS`.
- **`RESOURCES` and `#links` deleted** — `RESOURCES` was empty, and the user
  never rebuilt `#links` across two passes of curating the live server.
- **`#wins` moved into THE FORGE**, a paid category, with the bible-study
  tier and veterans granted on that one channel. Discord resolves a channel
  against its own overwrites, never its category's, so an unpaid member sees
  THE FORGE containing `#wins` alone. A test pins this both ways: they must
  reach `#wins`, and they must reach nothing else in that category.
- **`SETTING` and `SALES` merged** into one `SALES & SETTING` category, with
  one shared `#training-recordings` — sales calls, setting calls and the
  reviews of both, named so it can't be confused with the coaching or
  bible-study ones. `#convo-reviews` stays separate: a DM thread gets picked
  apart line by line. `#setting-faq`, `#tips` and `#call-reviews` retired by
  the user.
- **No brand-specific chat.** Per-tier conversation happens in each tier's
  own `#<tier>-chat` and one `#the-forge-chat` covers everyone paying, so
  `#coaches-general` / `#creators-general` were dropped. Brand roles gate
  nothing at all now.
- **`Founder` is `Nigel`** — that role already exists and is
  integration-managed, so it can't be renamed to the seat.
- **`Eddie` and `Ops Team` both become `Coach`** — function, not person, so
  it survives him and a second one doesn't need inventing. Ops Team wanted
  the same access, and may field setting questions later, so one role covers
  both. It reaches every category (including
  each tier's announcements and chat) but never a private client channel,
  since those are built from `tiers.js` `staffRoleNames`, which omits it. It
  carries `ManageEvents` for the weekly call. Whoever holds it can also hold
  a `Tier:` role as a client — the two compose.
- **The ~57 members with `Called Coaches` but no Airtable record get
  `Veteran`** — community access plus read-only `#wins`, no paid areas.
  Without this they would see only `WELCOME` the moment the restructure is
  applied, since access is deny-by-default.
- **Recording channels renamed to say what they record**:
  `#bible-study-recordings`, `#masterclass-recordings`, `#training-recordings`.
  Merging the brand categories made three channels called
  `call-recordings` visible to the same client at once; a test now enforces
  that no two channel names collide anywhere in the server. Warrior Huddles
  aren't recorded, bible study is.
- **Bot output lives in the ops server.** The EOD feed is already there, and
  onboarding flags plus the tier-change audit log now go to
  `DISCORD_OPS_NOTIFICATIONS_CHANNEL_ID` (defaults to `1547339220840882306`)
  rather than the client server. The client server's `STAFF` category is
  therefore just `#staff-general`. **The bot must be a member of the ops
  server** for any of this to send.
- **Veterans are assigned by hand and stay out of Airtable**, per the user:
  creating Client records for people the CSMs have never spoken to would
  just confuse them. Nothing reconciles the `Veteran` role against Airtable,
  by design.

### What the first live dry run caught

Run against the real server on 2026-09-10, the plan came back proposing to
create ~20 channels that already exist. Two causes, both fixed:

- **Live channel names carry decorative emoji and separators** — `🌐│welcome`
  rather than `welcome` — so exact-string matching found nothing. The apply
  script now matches exactly first, then on the name with emoji and
  punctuation stripped, and prints every loose match so they can be checked.
  New channels are still created with the plain config name; existing ones
  keep their styling.
- **The tier chat channel is `#<tier>-chat`**, matching `#the-forge-chat`,
  and consistent across all three tiers. The user had built
  `#momentum-general` and renames it to match.

Nothing was applied. This is what the dry run is for.

### What the live apply run caught

- **`DiscordAPIError[50013] Missing Permissions` part-way through.** A bot can
  only write an overwrite containing permissions it holds itself, and
  `edit()` is a read-modify-write: it carries forward whatever large deny mask
  the channel already had, which on a locked-down channel includes bits the
  bot doesn't hold. Fixed the same way `grant-bot-channel-access.js`
  documents — Administrator on the bot's role temporarily, re-run, remove it
  after. Removed after, on 2026-09-10.
- **The script could never report "up to date".** `overwritesMatch` demanded
  exact equality while `applyOverwrites` uses `edit()`, which merges — so a
  live overwrite legitimately holds bits the config never mentions, and a
  just-configured server still reported 17 changes. Now a subset check: every
  bit the config wants must be present and nothing it wants allowed may also
  be denied. Anything extra is left alone. Without this the script is useless
  as a drift detector, which is most of its long-term value.
- **`--invites` failed with `#welcome not found`.** The emoji-tolerant match
  had been applied to categories and channels but not to the invite lookup.

### #5 — rollout state as of 2026-09-10

Applied to the live server, run by the user from his own machine (the build
environment has no Discord token):

| Step | Result |
|---|---|
| `discord-structure --apply` | 26 changes applied |
| `grant-bot-channel-access` | granted 20, already had 120, 1 failed |
| `discord-migrate-roles --apply` | 87 assigned, 0 failed |
| `discord-structure --apply --invites` | 7 invites created, map pasted into Railway |
| Railway | branch corrected, bot live with the invite map loaded for all 7 links |

**Railway was deploying the wrong branch.** The repo has no `main`, and
Railway was pinned to `claude/automation-hub-discord-airtable-hu2pu3`, which
predates the restructure and contains none of the invite-routing code. The
structure was correct while the bot was not, which looks identical from
Discord. Fixed in Settings → Source. Worth remembering: the deploy log is the
only place that discrepancy is visible.

Still open:

- **The private client channels have not been moved yet.** This is the last
  step and the one the whole restructure exists for —
  `npm run discord-migrate-channels`, dry run first.
- **`@everyone` → View Channel is still ON.** Deny-by-default doesn't take
  effect until this is turned off, and it should not be turned off until the
  by-hand list below is done — anyone missed sees only `WELCOME`.
- **`TIER_SYNC_ENABLED` is still off** on Railway, deliberately. Turn it on
  once the channels are in place, or the first tier change will try to move a
  channel that isn't where it expects.
- **By hand**: Eddie needs `Tier: Inner Circle` (correctly skipped by the role
  migration as staff, but he is also a client); the two `Ops Team` members
  need `Coach`, then `Ops Team` can be deleted; 20 members matched neither
  Airtable nor a legacy client role and need a decision.
- **`Gabe Gois` appears in both the client and veteran lists** — two Discord
  accounts. Only one should end up with a tier role.
- **Rotate the seven invite links.** Their codes were pasted into a chat
  transcript during the rollout. Re-run `discord-structure --apply --invites`
  and update `DISCORD_INVITE_ROLE_MAP` on Railway.
- **Housekeeping** — Nick Martinez has `CSM = Unassigned`; Liam McCormack and
  Nathan Soriano have blank `Contract Value`; the `testing` record from the
  2026-09-09 onboarding test should be deleted.
- **`SETTING MANAGER` left alone** — integration-managed, one member, staying
  as-is per the user.

### Rename these by hand before applying

The apply script never renames or deletes, so a renamed thing would otherwise
be created empty alongside the original and the history would be stranded.
Renaming first means the script finds them and only fixes permissions.

| Rename | To |
|---|---|
| `SETTING` (category) | `TRAINING HUB`, then move `#sales-general` in and delete the empty `SALES` |
| `SETTING` → `#call-recordings` | `training-recordings` |
| `THE CALLED` → `#recordings` | `bible-study-recordings` |
| `💪` (category) | `VETERANS` |
| `Eddie` (role) | `Coach` — then add the two `Ops Team` members to it |
| `CALLED COACHES` → `#reel-ideas` | move into `THE FORGE` (the config puts it there, so leaving it creates a duplicate) |

`#coaches-general` and `#creators-general` have no home in the config — brand
chat was dropped in favour of per-tier chat plus one shared `#the-forge-chat`.
Retire them, or the `CALLED COACHES` / `CALLED CREATORS` categories linger
unmanaged.

### A bug caught while wiring Veterans

`tierSync` originally wrote an empty `Package / Tier` whenever a tier role
was removed. That is the exact path a client takes when they finish and
become a Veteran — so it would have quietly destroyed the record of what
every graduating client had paid for. Removal now leaves the tier alone and
logs that it did; `Status` is the field that should change, and tier sync
never touches it.

### Correction to #3's note

The note below originally recorded **Wylie Hawkins** as a "bible-study-only
client". That was wrong: his live Airtable record is Called Creators / Inner
Circle, $20,000 contract fully collected. He is genuinely out of scope for
Discord — the $20k buys 6 months of 1:1 calls with Nigel, serviced outside
the server — which is why he has no Discord ID and no private channel, and why
`Skip Weekly Reminder` is correctly checked. The third bible-study skip is
**Brian Pascal**. His record should carry a note marking him 1:1-only so he
isn't later mistaken for a missing Inner Circle member.

### #4 — waiting on the user

- **Notion Dashboard link** — message currently says "You will get your Notion Dashboard shortly." instead of a real link. Once provided, set `NOTION_DASHBOARD_URL` on Railway and the message switches to the real link automatically — no code change needed.
- **Onboarding walkthrough video** — not made yet, so the welcome message no longer references one at all (removed per the user rather than left as a broken promise). Once it exists, ask where/how it should be added back into the message (embedded link, separate message, etc.) and update `src/onboarding/welcomeMessage.js`.

Deployed on Railway (Hobby plan — chosen over Render because this service runs
continuously in the background and Render's free tier spins down idle services,
which would have silently killed the poller/bot connection). Both automations
were confirmed live on 2026-09-09 by creating a real record in each Airtable
table and watching the Discord message arrive.

One setup wrinkle worth knowing for #3/#4: both Discord servers lock channels
down per-category, so inviting the bot didn't grant it visibility into private
channels (`DiscordAPIError[50001]: Missing Access`). Fixed once with
`scripts/grant-bot-channel-access.js` — see the README section on it. Any
*new* category created later will need the same one-time grant repeated.

## How #1 and #2 work

Airtable Automations has no built-in "call an external URL" action and no Discord
action (checked via the Airtable automation-builder tool's action catalog before
building), so this hub polls the Airtable REST API on an interval instead of
depending on Airtable-side webhooks. Each automation tracks a per-table "last seen"
timestamp in `data/state.json` (`STATE_FILE_PATH`) and only notifies about records
created after that mark. See the "State persistence" note in `README.md` for the
one operational caveat this creates on ephemeral hosting disks.

## Whop integration for #4 — deferred, not rejected

The client server already has a "Whop Bot" role/integration installed
(discovered while scoping #4), but the user didn't set it up and doesn't know
what it currently does. Considered using it to auto-capture email at
purchase instead of asking in Discord, but deferred for this build:
unclear whether it's Whop's native Discord role-sync (simpler, different
design) or would need a custom webhook + purchase/join correlation (a real
second integration, no shared ID between a Whop purchase and a Discord join
event). #4 ships with the reply-with-email version first; investigating what
the existing Whop Bot role actually does, and whether it's worth wiring in,
is a genuine follow-up once #4 is proven live — not scoped here.

## Open item carried over from the blueprint

The "EOD Reports" base (`appO76t48mwkC3j80`) overlaps with gaps documented in
`05_Sales_Pipeline_Blueprint.md` (touchpoint counts) and `06_Operations_Pipeline_Blueprint.md`
(Stage 5 at-risk/churn). A separate session should pull it into a proper schema
reference doc and reconcile it against both blueprints — still out of scope here.
