# Automation Hub — Build Status

Tracks progress against the build priority in `Automation_Hub_Blueprint.md`.

| # | Automation | Status | Notes |
|---|---|---|---|
| 1 | Setter EOD → Discord | ✅ Built | Polls `Setter EOD` (EOD Reports base) on `POLL_INTERVAL_MS`, posts to `DISCORD_SETTER_EOD_CHANNEL_ID`. |
| 2 | Weekly Check-in → Discord | ✅ Built | Polls `Weekly Check-ins` (Client Success base) the same way, posts to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` (a separate channel/server from #1, at the user's request). |
| 3 | Discord ID field + Friday reminder DMs | ⛔ Not started | Needs the Friday send time decided, plus a manual backfill of Discord ID for the 9 current clients before it can go live. |
| 4 | New-member onboarding flow | ⛔ Not started | Blocked on the onboarding message copy/sequence and a decision on who besides the client sees the private channel. |

Deployment (Railway/Render account + env vars) is a manual, one-time step outside
Claude Code — see `README.md`. Nothing in this repo has been deployed yet; #1 and
#2 are code-complete and unit-tested but not running against live Discord/Airtable
credentials.

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
