# Setter Dashboard — build plan and Airtable replacement

The decision on record: **fully replace Airtable**, with the dashboard as the new
system of record. This doc is how that happens without breaking the four live
automations on the way.

## Why it's phased

"Replace Airtable" is four separate migrations, not one:

| Airtable surface | What's in it | Who depends on it |
|---|---|---|
| The Called Lead Tracker | 541 leads, 30 fields | Loui, Alexis |
| EOD Reports | Setter EOD, Post Call, Dialler EOD, CSM EOD | Automation #1 (Discord notify) |
| The Called — Client Success | Clients (22 active), Weekly Check-ins | Automations #2, #3, #4 |
| Airtable Forms | The client-facing Weekly Check-in form | Every active client, weekly |

Only the first has no live automation hanging off it, which is why it goes first.
Doing all four at once means rewriting a working Discord bot, a Friday DM
scheduler, and a client-facing form in the same change as a brand new app — for
no benefit, since the setters' problem is solved by phase 1 alone.

## Phases

**Phase 1 — setter dashboard (in progress).** Lead list, Calendly booking flow,
confirm, triage, notes, EOD form. Loui and Alexis stop opening Airtable. Nothing
else moves; the hub keeps reading Airtable exactly as it does today.

**Phase 2 — EOD reports.** Move the four EOD tables over and repoint automation
#1 at Postgres. Self-contained: these tables link to nothing else.

**Phase 3 — Client Success.** Clients + Weekly Check-ins, and with them
automations #2, #3 and #4. The heaviest phase: it includes rebuilding the
client-facing Weekly Check-in form, which real clients use weekly, plus the
rollups (`Momentum Trend`, `Last Check-in`, `% Paid`) that Airtable computes for
free today.

**Phase 4 — decommission.** Export everything, cancel the seats.

## The ongoing cost of leaving Airtable

Worth stating plainly, because it doesn't show up until month three: in Airtable,
Nigel adds a field or renames a dropdown option in ten seconds. Here, a field is
a schema change, a migration and a deploy.

Mitigated, not eliminated, by the `option_sets` table: every dropdown the team
actually churns on — conversation stage, lead source, opener, lead quality,
cancel reason, lost reason — is rows in the database, editable in an admin screen
without a deploy. Adding a genuinely new *field* still needs a code change. That
trade is the price of the rest of it, and it's the right trade at five people,
but it's a real one.

## Schema notes

Full schema: `dashboard/src/db/schema.ts`.

Deliberate departures from the Airtable original:

- **`Call Booked Date` split into `call_booked_at` and `call_scheduled_for`.**
  Airtable conflated "when they booked" with "when the call is". A "calls today"
  view is impossible without separating them, and that view is the dashboard's
  main screen.
- **`phone` added.** Triage is a phone call. The Airtable tracker has no phone
  field at all, so the workflow the setters described can't currently be recorded.
- **Notes became a table.** One `Notes` blob per lead means whoever types last
  wins. `lead_notes` is authored and timestamped.
- **`Analytics Stage` dropped.** It overlapped `Conversation Stage` almost
  entirely (14 options vs 24, same concepts). One stage field, one meaning.
- **`lead_events` added.** An audit row for every stage change, confirm, triage
  and booking. Nothing reads it in phase 1; it's what makes "what did Loui
  actually do Tuesday" answerable later without reconstructing it from guesses.
- **`triage_notes` is its own column**, not a note. It's the qualification
  handoff a closer opens right before the call, and it shouldn't be buried in a
  thread.

## Migration of existing leads

No CSV export needed — this session has Airtable API access and can read the
tracker directly at migration time, which also avoids a stale export.

Open question before that runs: which of the 541 rows are worth bringing. Most
are dead outreach from months ago. Recommendation is to import leads with any
activity in the last 90 days plus anything with a booked call, and archive the
rest to a cold table rather than deleting them.
