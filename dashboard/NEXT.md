# Next up

Parked work and what is left before the team uses this. Everything here is
deliberate, not forgotten.

## Before launch — Francis only

These cannot be done from a branch. They need the live dashboard.

1. **Check Loui and Alexis's addresses took.** Admin → People — both should
   read a real address with "can sign in: yes", not *needs a real address*.
   The deploy sets them (`lalbawab6@gmail.com` for Loui,
   `alexisleid7@gmail.com` for Alexis) by replacing the placeholder they were
   seeded with; an address already typed in by hand is never overwritten. If
   either is wrong, edit it there — sign-in matches on email, so a wrong
   address is the difference between somebody getting in and not.
2. **Split the old leads by date.** Admin → Setup & imports → Move a pile of
   leads by date. The Setter column in the old tracker was blank for most of
   its life, so a long run of leads sits on one name. Cash follows whoever
   owns the lead, so until this is done every setter's cash figure is wrong.
   Pick the pile with the leads in it — the dropdown shows each one's size —
   dry run, read the three bands, then move.
3. **Set the monthly targets.** Admin → Setup & imports → Monthly targets.
   Without them the pace bars on the Dashboard do not draw at all. A target
   nobody set is not a target being missed, so this is optional — but the
   bars are most of what makes the Dashboard worth opening in the morning.
4. **Take a backup.** Admin → Backups → Back up now. One before the team
   starts writing to it is worth having.
5. **Send the team the Help link.** `/help` is the manual. It has a setter
   half and an admin half, so a setter is not shown buttons they do not have.

## Waiting on Francis, not blocking

**Boosted reels.** `/ads` holds one tile per reel: an Instagram embed, the
spend, the cash, and the rates worked out from them. Nothing runs right now,
so the page is empty by design. Two things to settle when reels do go live:

- **Spend currency.** Each reel carries its own, defaulting to USD. If the ad
  account bills CAD while contracts are USD, a cost-per-lead that mixes them
  is nonsense — so the figure is only ever shown next to its own currency.
- **Whether "conversations started" should be counted rather than typed.**
  Leads already carry a source; if setters tagged a lead with the reel it
  came from, that column and the two after it would fill themselves. That is
  a behaviour change for the team, so it is not assumed.

## Built and done

- **View as Loui / Alexis.** Admin → People. Swaps the identity the whole app
  resolves to, so the menu, the numbers and the pages are the ones sign-in
  actually returns — not admin's data relabelled. Read-only while it is on.
- **Backups.** Railway only offers them on the Pro plan ($20/mo against
  Hobby's $5), so the dashboard does it itself: a full CSV copy of every
  table posts to the COO chat on Discord every seven days, triggered the
  first time anybody opens the dashboard after that. Admin → Put a backup
  back reads those files straight in, filling gaps without overwriting
  anything newer. At the current size a copy is 224 KB against Discord's
  10 MB limit, and it refuses rather than posting a partial set.
- **Moving leads between people by date**, with a dry run that reports the
  cash in each band before anything moves.

## Decided, deliberately not built

- **EOD streak honesty.** A missed day breaks the streak and the report can
  still be filed late. Francis wants it that way: going back to fill in a
  missed day reinforces the habit even though the streak is gone.
- **Splitting compound cancel reasons** such as "Bad Fit, No Money". The
  team's own Airtable vocabulary is the source of truth and stays as-is.
