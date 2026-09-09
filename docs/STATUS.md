# Automation Hub — Build Status

Tracks progress against the build priority in `Automation_Hub_Blueprint.md`.

| # | Automation | Status | Notes |
|---|---|---|---|
| 1 | Setter EOD → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Setter EOD submission posted to `DISCORD_SETTER_EOD_CHANNEL_ID`. |
| 2 | Weekly Check-in → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Weekly Check-in submission posted to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` (a separate channel/server from #1, at the user's request). |
| 3 | Discord ID field + Friday reminder DMs | ✅ Live | `WEEKLY_REMINDER_ENABLED=true` set on Railway and confirmed on 2026-09-09; deployment stable. First real send: Friday 2026-09-11, 12:00 PM ET (`America/New_York`, DST-aware). 19 of 22 active clients backfilled with a Discord ID; Wylie Hawkins, Malachi Hardware, Patric Cocos have `Skip Weekly Reminder` checked (bible-study-only clients, no personal-branding access, confirmed with the user). Message: "Hey [First Name], time for your Weekly Check-in — [link]". Dry-run path (`npm run weekly-reminder-dry-run`) still available for testing future changes without risk. |
| 4 | New-member onboarding flow | ✅ Live | Enabled on Railway and verified end-to-end on 2026-09-09 with a real test-account join: channel creation, permissions, welcome message (mentions rendering correctly), and the no-match path were confirmed working via a real join in the client server. Design went through two iterations after that first live test: (1) no-match originally just flagged staff and waited — the user pointed out a new signup's Airtable record essentially never exists yet at join time, so that path would have fired for almost every real new member; (2) briefly fixed with a retry-on-poll-cycle mechanism, then the user clarified they actually wanted the automation to create the starter Client record itself (Name, Email, Discord ID, Start Date, Status Active) rather than wait on staff — so it does that now, and the retry mechanism was removed as unnecessary. Flag channel is a dedicated channel (`DISCORD_ONBOARDING_FLAG_CHANNEL_ID`), not the Weekly Check-in channel, per the user's request after seeing the first test flag land there. Team "new member joined" notification explicitly dropped per the user — they want a separate Whop-based notification with purchase amount instead (not built). Status `Active` on the starter record was a deliberate choice, confirmed with the user, even though it makes the client immediately eligible for automation #3's Friday reminder before a CSM is assigned. |
| 5 | Discord restructure: roles, tier categories, invite routing | 🔨 Built, not applied | Blueprint approved. `src/discord/serverStructure.js` defines 15 roles, 13 categories and 36 channels; `scripts/apply-discord-structure.js` reconciles them (dry-run by default, additive only, never deletes). Invite-link routing and tier sync are wired but `TIER_SYNC_ENABLED` is off. **Nothing has been applied to the live server yet.** The Whop blocker cleared on 2026-09-09; see the decisions and open items below. |

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
  access to THE CALLED plus the 💪 section, and nothing else. Named Veteran
  rather than Alumni because a badge sitting next to paying clients in #wins
  should read as "been through it", not "former customer". It is deliberately
  *not* a tier role: nobody is paying for it, so a tier role would make tier
  sync write a package onto a Completed/Cancelled record. `#wins` is
  read-only for them, which is the whole re-enrolment mechanic — they see
  what is happening and cannot reach what produced it.
- **Brand duplication stays.** `course-content`, `recordings`, `links` and
  `content-review` remain per brand: a client only ever sees their own
  brand's category, so nobody encounters two `#recordings`.
- **SETTING and SALES open at Momentum, for both brands** — not coaches-only.

### #5 — still open

- **Is `#eod-feed` in this server or the ops server?**
  `DISCORD_SETTER_EOD_CHANNEL_ID` may point at the other one; the structure
  config assumes this one.
- **Housekeeping** — Nick Martinez has `CSM = Unassigned`; Liam McCormack and
  Nathan Soriano have blank `Contract Value`; the `testing` record from the
  2026-09-09 onboarding test should be deleted.
- **Veterans have no Airtable records.** The people in 💪 don't appear in the
  Clients table in any status, so there is nothing to reconcile the `Veteran`
  role against — it has to be assigned by hand for now.
- **Nothing has been applied to the live server yet.** No Discord token was
  available in the build environment, so the structure config is verified by
  tests only. The first live run must be without `--apply`.

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
