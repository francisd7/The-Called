# Automation Hub Blueprint — Discord / Airtable Notifications & Onboarding

*Applies the Blueprint Mapping Framework to the first slice of the owned automation hub — the Claude Code–built replacement for what Zapier would have handled. This is shared infrastructure, not a fourth pipeline pillar: every automation here plugs into the same server, and future Sales/Operations/Content automations should extend it rather than starting a new build.*

---

## Important finding before this gets built

While mapping this, a live check of the Airtable account turned up an **"EOD Reports" base** (`appO76t48mwkC3j80`) that isn't referenced in any current project doc. It already contains:

- **Setter EOD** — Date, Setter Name, Total Outbounds Sent, Total Follow Ups Sent, Total Leads (1+ Replies), YouTube Videos Sent, Total Calls Pitched, Total Calls Booked, Cash Collected, Revenue Generated, plus win/obstacle/focus notes
- **Post Call** — Lead Name, Closer, Setter Booked, Call Outcome, Payment Method, Cash Collected, Revenue
- **Dialler EOD** — Dials Made, Pickups, Talk Time, Calls Pitched, Calls Booked
- **CSM EOD** — Clients Onboarded, Check-ins Completed, Renewals Closed, Upsells Closed, Cancellations Handled/Win-Backs, **Clients Flagged At Risk**, Revenue from Renewals/Upsells

This directly overlaps with two documented gaps: 05_Sales_Pipeline_Blueprint.md's "touchpoint count can't be answered today" claim, and 06_Operations_Pipeline_Blueprint.md's Stage 5 (at-risk/churn) gap. Both may be smaller than documented. **Recommend a separate session to pull this base into a proper schema reference doc and reconcile it against both blueprints** — out of scope for this build, but flagged so it doesn't get lost.

## Architecture (read before building)

- **Where the code runs:** a small always-on web server (Node.js or Python), hosted on Railway or Render, connected to a GitHub repo. Claude Code — Cloud or terminal, either works — writes and pushes the code; the host runs it continuously and auto-redeploys on push.
- **Not in Claude Code itself.** Cloud sessions are for writing and editing code; the VM isn't meant to stay running as a live listener. The hosting account is a separate, one-time setup step.
- **Credentials needed**, stored as environment variables on the host, never written into code: Discord bot token (Discord Developer Portal), Airtable Personal Access Token (scoped to both the Client Success base and the EOD Reports base), Whop API key (not needed for any of these four automations — none of them key off Whop directly, per the trigger decisions below).
- **The matching problem:** a couple of these automations need to tie a specific Discord user to a specific Airtable Client record. Handled per-automation below.

---

## Automations, in build order

### 1. Setter EOD submitted → Discord team notification *(build first)*

| Column | Detail |
|---|---|
| Trigger | New record created in **Setter EOD**, `EOD Reports` base |
| Action | Post to team Discord channel: "[Setter Name] submitted their EOD report — [Date]" |
| Branches | None — single terminal action |
| Data to capture | Nothing new — reads off the existing record |
| % Automatable | 100% |
| Requires human | None |
| System of record | Airtable (EOD Reports base) |

Cleanest possible pilot: no new Airtable schema, no Discord identity needed, nothing to match. Proves the hosting + webhook chain works end to end before anything harder gets built on top of it.

### 2. Weekly Check-in submitted → Discord team notification

| Column | Detail |
|---|---|
| Trigger | New record created in **Weekly Check-ins**, `The Called — Client Success` base |
| Action | Post to team Discord channel: "[Client Name] submitted their Weekly Check-in — Momentum: [Momentum Rating]" |
| Branches | None |
| Data to capture | Nothing new |
| % Automatable | 100% |
| Requires human | None |
| System of record | Airtable (Client Success base) |

Same pattern as #1 — bundle into the same build session, second-cheapest addition.

### 3. Weekly Check-in reminder → individual client DM (fixed Friday schedule)

| Column | Detail |
|---|---|
| Trigger | Scheduled — every Friday at a set time (TBD) |
| Action | Bot sends each active client a Discord DM: "Hey [Name], time for your Weekly Check-in — [prefilled link]" |
| Branches | Client has no Discord ID on file → skip and log it, don't fail silently |
| Data to capture | **New field needed on Clients: Discord ID** — doesn't exist today |
| % Automatable | ~95% — sending is mechanical, the exception list needs a human to notice |
| Requires human | One-time backfill of Discord ID for the 9 current clients; weekly glance at the skip list |
| System of record | Airtable (Client Success base) — needs the new field added |

**Decision made above:** manual backfill now, automatic capture going forward via #4 — don't build self-registration for 9 people.

### 4. New Discord member → team notification + private onboarding channel + auto messages

| Column | Detail |
|---|---|
| Trigger | Discord's native "member joined" event — **not** a Whop event, so recurring payments never falsely trigger it |
| Action | (a) post to team channel: "New member joined: [Discord username]" (b) create a private channel visible only to that member + staff (c) run the onboarding message sequence in it (d) ask them to reply with the email they purchased with, match it to a Clients record, write their Discord ID back into that record |
| Branches | Email doesn't match any Client record → flag in the team channel for a human to sort out, don't leave the person stuck |
| Data to capture | Discord ID written back to the matched Client record — this is what closes #3's gap permanently |
| % Automatable | ~80% — mechanics are automatable; matching failures and message tone are not |
| Requires human | Writing the actual onboarding message sequence (content, not mechanics); resolving unmatched joiners |
| System of record | Discord (channel/role state) + Airtable (Client match) |

**Still needed before this one can be built:** the actual onboarding message text and sequence (how many messages, what they say, timing between them), and who besides the client should see the private channel.

---

## What this blueprint exposes

1. The "EOD Reports" base is a real gap in project documentation, not a missing build — it already holds data two other blueprints assumed didn't exist.
2. Automations #1 and #2 need zero new Airtable schema and no identity-matching logic — they're the correct pilot, not #4, even though #4 was the most-described automation originally.
3. The Discord-ID-on-file gap is really one gap, not two (reminders in #3 and matching in #4 both need it) — solved once, in #4, rather than twice.

## Build priority

1. Setter EOD → Discord (pilot — proves hosting, credentials, and posting all work)
2. Weekly Check-in → Discord (same session, same pattern)
3. Add Discord ID field to Clients, backfill the 9 manually
4. Friday reminder DMs
5. New-member flow (channel + onboarding messages) — blocked on onboarding copy from you
