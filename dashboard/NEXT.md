# Next up

Parked work, newest ask first. Everything here is deliberate, not forgotten.

## 1. ~~"View as Loui / Alexis" in admin~~ — built

Admin -> People has a **View as** button per active person. It swaps the
identity the whole app resolves to, so the menu, the numbers and the pages
are the ones that sign-in actually returns - not admin's data relabelled.
Read-only while it is on, with a fixed bar at the bottom of every screen to
get back out.

## 2. ~~A "Data" tab, starting with boosted reels~~ — built, waiting on the reels

`/data` holds one tile per boosted reel: an Instagram embed, the spend, the
cash, and the rates worked out from them. Below it, the same reels side by
side in a table.

Every number is entered by hand — Instagram insights and Ads Manager are
not readable from here, and the ones that matter most (did this reel produce
a call, did that call close) only exist in this dashboard anyway. Nothing
derived is stored: cost per lead, return, net and the funnel rates are
computed on read so they cannot drift from the numbers they came from.

**Still open:** Francis pastes the current boosted reels. Two things to
settle when he does:

- **Spend currency.** Each reel carries its own, defaulting to USD. If the
  ad account bills CAD while contracts are USD, a cost-per-lead that mixes
  them is nonsense — so the figure is only ever shown next to its own
  currency. Worth confirming which the ad account actually uses.
- **Whether "conversations started" should be counted rather than typed.**
  Leads already carry a source; if setters tagged a lead with the reel it
  came from, that column and the two after it would fill themselves. That is
  a behaviour change for the team, so it is not assumed.

## Backups — done, and not the way we planned

Railway only offers them on the Pro plan ($20/mo against Hobby's $5), so the
dashboard does it itself. A full CSV copy of every table posts to the COO
chat on Discord every seven days, triggered the first time anybody opens the
dashboard after that — nobody has to remember, and the copy is not on the
same disk as the database it protects. Admin → Put a backup back reads those
files straight in, filling gaps without overwriting anything newer.

At the current size a copy is 224 KB against Discord's 10 MB limit, and the
backup refuses rather than posting a partial set if it ever outgrows it.

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
