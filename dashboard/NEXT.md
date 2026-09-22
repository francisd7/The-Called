# Next up

Parked work, newest ask first. Everything here is deliberate, not forgotten.

## 1. "View as Loui / Alexis" in admin

Francis needs to see the dashboard exactly as a setter sees it, so he can
reproduce what they report rather than guess at it.

The requirement that makes this non-trivial: **it has to be accurate.** A
preview that only swaps the name in the corner is worse than nothing - it
would show Francis a working page while the setter is looking at a broken
one. Whatever is built has to run the real queries through the real
permission checks as that user, not re-render admin's data under a
different label.

Notes for whoever picks it up:

- Role and identity come off the JWT (`src/auth.ts`), and pages read it
  through the session. An impersonation that does not change what the
  session resolves to will not change what the queries return.
- Leaving it on by accident is the obvious hazard - anything written while
  viewing-as would be written as that setter. Either make the whole session
  read-only while impersonating, or keep an unmissable banner with a one
  click way out. Read-only is the safer default.
- Admin only, and it should be visible in the audit trail: if a lead event
  gets written during a view-as session, it should say who really did it.

## 2. A "Data" tab, starting with boosted reels

A new top-level section for reference data the team keeps by hand, rather
than anything the pipeline generates.

First use: boosted reels. Roughly five tiles across, one per reel, with
performance numbers on each. Francis will paste the current set of boosted
reels to seed it - **ask him for that list before building the schema**, so
the fields match what he actually tracks rather than what seems likely.

Build the table around the numbers he gives, not around a guess.

## Open items Francis is handling himself

- Merge the duplicate pairs on `/leads/duplicates`.
- Log the outcomes still owed on past calls.
- Link the pending post-call reports.
- Check Loui and Alexis can both sign in (Admin -> People, look for
  "needs a real address").

## Decided, deliberately not built

- **EOD streak honesty.** A missed day currently breaks the streak and the
  report can still be filed late. Francis wants it that way: going back to
  fill in a missed day reinforces the habit even though the streak is gone.
- **Splitting compound cancel reasons** such as "Bad Fit, No Money". The
  team's own Airtable vocabulary is the source of truth and stays as-is.
