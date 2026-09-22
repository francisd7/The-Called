# Next up

Parked work, newest ask first. Everything here is deliberate, not forgotten.

## 1. ~~"View as Loui / Alexis" in admin~~ — built

Admin -> People has a **View as** button per active person. It swaps the
identity the whole app resolves to, so the menu, the numbers and the pages
are the ones that sign-in actually returns - not admin's data relabelled.
Read-only while it is on, with a fixed bar at the bottom of every screen to
get back out.

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
