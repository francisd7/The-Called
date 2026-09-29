# Next up

Parked work and what is left before the team uses this. Everything here is
deliberate, not forgotten.

## Before launch — Francis only

Done, in the order they were done:

- **Addresses.** Loui is `lalbawab6@gmail.com`, Alexis `alexisleid7@gmail.com`,
  both confirmed signing in. The seed replaces the `CHANGEME` placeholder on
  boot and never overwrites an address typed in by hand, so a correction made
  in Admin → People stands.
- **The old leads are split.** 248 leads and $18,170 moved to Loui, 177 and
  $17,350 left with Francis, 16 and $11,000 unassigned. Re-running the same
  dry run reports nothing left in the middle band, which is how to check.
- **Monthly targets** are set, so the pace bars draw.
- **The tracker is fully imported.** 592 rows, 0 new — there is nothing
  waiting in Airtable. Re-running it changes nothing but refreshed fields, and
  will not disturb the split: the import only writes a setter where Airtable
  has one, and only two rows before 2026-08-27 do (both Alexis).

Still to do:

- **Take a backup.** Admin → Backups → **Back up now**. It ignores the
  seven-day timer, so it runs whenever it is pressed. Worth having one from
  before the team starts writing.
- **Point them at Help.** `/help` is in the top bar for everybody once they
  sign in, so there is no link to send — but people do not click what nobody
  told them about. Mention it when you walk them through.

## Watch after launch

**Archiving a lead is the newest thing here**, built late on the night before
launch. A review the morning after found four real holes in it — search and
the day's calls both still showed archived leads, a Calendly booking could
land on one invisibly, and the migration had no snapshot, which would have
failed the boot on the next schema change. All fixed and re-verified by lead
id across every list. It is sound now, but it is the least-exercised code in
the dashboard, and if something has to be rolled back it is commits `3afdead`,
`449287b` and `29f5dbd`, which stand alone.

The thing to watch is the one its own module doc predicts: a query somebody
forgot. If an archived lead ever shows up somewhere it should not, the list to
check is every place using `liveLead` in `src/lib/leadScope.ts` — and the two
that deliberately do not, the Airtable import and the Calendly backfill, both
of which have to see archived rows or they create a second copy of the person.

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
