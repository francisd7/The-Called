# Automation Hub — Build Status

Tracks progress against the build priority in `Automation_Hub_Blueprint.md`.

| # | Automation | Status | Notes |
|---|---|---|---|
| 1 | Setter EOD → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Setter EOD submission posted to `DISCORD_SETTER_EOD_CHANNEL_ID`. |
| 2 | Weekly Check-in → Discord | ✅ Live | Deployed to Railway, verified end-to-end: a real Weekly Check-in submission posted to `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` (a separate channel/server from #1, at the user's request). |
| 3 | Discord ID field + Friday reminder DMs | ✅ Live | `WEEKLY_REMINDER_ENABLED=true` set on Railway and confirmed on 2026-09-09; deployment stable. First real send: Friday 2026-09-11, 12:00 PM ET (`America/New_York`, DST-aware). 19 of 22 active clients backfilled with a Discord ID; Wylie Hawkins, Malachi Hardware, Patric Cocos have `Skip Weekly Reminder` checked (bible-study-only clients, no personal-branding access, confirmed with the user). Message: "Hey [First Name], time for your Weekly Check-in — [link]". Dry-run path (`npm run weekly-reminder-dry-run`) still available for testing future changes without risk. |
| 4 | New-member onboarding flow | ✅ Live | Enabled on Railway and verified end-to-end on 2026-09-09 with a real test-account join: channel creation, permissions, welcome message (mentions rendering correctly), and the no-match path were confirmed working via a real join in the client server. Design went through two iterations after that first live test: (1) no-match originally just flagged staff and waited — the user pointed out a new signup's Airtable record essentially never exists yet at join time, so that path would have fired for almost every real new member; (2) briefly fixed with a retry-on-poll-cycle mechanism, then the user clarified they actually wanted the automation to create the starter Client record itself (Name, Email, Discord ID, Start Date, Status Active) rather than wait on staff — so it does that now, and the retry mechanism was removed as unnecessary. Flag channel is a dedicated channel (`DISCORD_ONBOARDING_FLAG_CHANNEL_ID`), not the Weekly Check-in channel, per the user's request after seeing the first test flag land there. Team "new member joined" notification explicitly dropped per the user — they want a separate Whop-based notification with purchase amount instead (not built). Status `Active` on the starter record was a deliberate choice, confirmed with the user, even though it makes the client immediately eligible for automation #3's Friday reminder before a CSM is assigned. |
| 5 | Client Notion dashboards | 🔨 Built, gated off | Delivery design settled 2026-09-18: the client gets their dashboard link automatically, in their own channel, the moment they reply with their email — chosen over a staff-gated handoff with the "client may click before the guest invite lands" trade-off explicitly understood. Mitigated rather than solved: the staff ping mentions the CSM role and states the client already has the link, and the client's message warns about the request-access screen. | Code complete and unit tested; nothing has run against a real Notion workspace yet. `NOTION_DASHBOARD_ENABLED` is unset, so no page is created and nothing is written back to Airtable. The user is testing against a **mock** Notion database first, then swapping `NOTION_DASHBOARDS_DATABASE_ID` for the real one once the template is finalised — no code change involved in that swap, which is why every Notion ID is an env var. |

### #5 — waiting on the user

- ✅ **Airtable fields — done.** `Notion Dashboard URL` (url) and
  `Discord Channel ID` (single line text) were added to the Clients table on
  2026-09-18. Both are automation-written and carry field descriptions saying
  so. Clearing the URL re-triggers creation (or re-links the existing page).
- **Notion side** — a Client Dashboards database with the dashboard template
  saved as a database template and set as default, plus an internal
  integration connected to that database (`•••` → Connections). The template
  content was moved across by copying the blocks out of the existing
  standalone "THE CALLED HEADQUARTERS Template" page; icon and cover don't
  copy with the blocks and have to be set on the template by hand once.
- **Clients must not be able to duplicate the dashboard into their own
  Notion.** Flagged by the user as a hard requirement — the template is
  high-value IP and the whole reason it stays in our workspace instead of
  being handed out as a duplicatable template. Three levers, in order of how
  much they actually protect:
  1. **Permission level is the reliable one.** `Can edit` gives a guest the
     Duplicate action. `Can view` / `Can comment` does not. This is the
     lever that definitely works and costs nothing.
  2. **Workspace security settings** — Settings → Security → *Disable
     duplicating pages to other workspaces* and *Disable export* (blocks
     PDF/HTML/Markdown/CSV export). ⚠️ Notion's own wording for the first one
     says it stops **members**; whether it also binds **guests** is not
     confirmed, and the plan it requires wasn't confirmed either (help pages
     weren't reachable to verify). **Test both with a real guest account
     before trusting them.** If they're greyed out, that's the plan answer.
  3. **Nothing stops screenshots, or selecting visible text and pasting it.**
     Any of this raises friction; none of it makes the content
     uncopyable. Worth being honest about internally rather than assuming
     the IP is sealed.

  **Open decision, and it blocks nothing else:** the automation's Discord
  handoff message currently says to invite the client as **Can edit**
  (`formatDashboardCreatedMessage` in `src/dashboards/clientDashboard.js`).
  If clients get `Can view`/`Can comment` instead, that's a one-word change
  there — but then they can't tick boxes or write anything on their own
  dashboard. The way out of that trade-off is the split raised earlier in
  the design: the valuable frameworks/training live on **one shared master
  page** granted `Can view` once, and the per-client dashboard row stays
  `Can edit` because it only holds their own goals, tasks and check-ins.
  That protects the IP without taking away the thing the dashboard is for.

- **Guest invites stay manual, by necessity.** Notion publishes no API for
  page permissions or sharing — verified against the official SDK, which has
  no permissions endpoint — and "Share to web" can't be toggled through the
  API either. So the automation goes as far as it can and hands off: the
  Discord message carries the dashboard link and the client's email so the
  invite is a copy-paste. Page-level access rules (Notion **Business** plan)
  would remove the per-client share for people who are already guests, but a
  brand-new client still has to be invited once to become one, so it was not
  recommended on cost grounds. Revisit if client volume makes the manual
  invite a real bottleneck.

- **Welcome message copy vs `NOTION_DASHBOARD_URL`** — that variable now
  fits the shared resources/training page, not a personal dashboard, but
  `welcomeMessage.js` still calls it "your Notion Dashboard". Left alone
  rather than rewritten, because it's client-facing copy and the user's call.
  The "You will get your Notion Dashboard shortly." fallback is still exactly
  right — the instant path is what delivers on it.

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
