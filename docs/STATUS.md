# Automation Hub — Build Status

Tracks progress against the build priority in `Automation_Hub_Blueprint.md`.

| # | Automation | Status | Notes |
|---|---|---|---|
| 1 | Setter EOD → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Setter EOD submission posted to `DISCORD_SETTER_EOD_CHANNEL_ID`. |
| 2 | Weekly Check-in → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Weekly Check-in submission posted to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` (a separate channel/server from #1, at the user's request). |
| 3 | Discord ID field + Friday reminder DMs | 🟡 Built, not yet enabled | `Discord ID` + `Skip Weekly Reminder` fields on Clients; 19 of 22 active clients backfilled as of 2026-09-09 (Wylie Hawkins, Malachi Hardware, Patric Cocos intentionally excluded — bible-study-only clients, no personal-branding access). Real send path + Friday-noon-ET schedule (`America/New_York`, DST-aware) wired into `src/index.js`, gated behind `WEEKLY_REMINDER_ENABLED` (unset on Railway as of this writing — **not live**). Message uses first name only, per request. Dry-run path (`npm run weekly-reminder-dry-run`) remains available and still can't send a real DM. To go live: set `WEEKLY_REMINDER_ENABLED=true` on Railway. |
| 4 | New-member onboarding flow | ⛔ Not started | Blocked on the onboarding message copy/sequence and a decision on who besides the client sees the private channel. |

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

## Open item carried over from the blueprint

The "EOD Reports" base (`appO76t48mwkC3j80`) overlaps with gaps documented in
`05_Sales_Pipeline_Blueprint.md` (touchpoint counts) and `06_Operations_Pipeline_Blueprint.md`
(Stage 5 at-risk/churn). A separate session should pull it into a proper schema
reference doc and reconcile it against both blueprints — still out of scope here.
