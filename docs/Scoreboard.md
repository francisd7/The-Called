# The Scoreboard — build, Notion copy & Loom scripts

Replaces the Notion tracking dashboards with one Google Sheet per client.
Template: [`The_Called_Scoreboard.xlsx`](The_Called_Scoreboard.xlsx) ·
Notion cheat sheet: [`Cheat_Sheet_for_Notion.md`](Cheat_Sheet_for_Notion.md) ·
recording copy with sample data: [`The_Called_Scoreboard_DEMO.xlsx`](The_Called_Scoreboard_DEMO.xlsx) ·
regenerate with `python3 scripts/build_scoreboard.py [--demo]`.

**Content Planner stays in Notion.** Boards, calendars and per-post script pages are things
Notion does better, and the Content Chamber board already works.

---

## The logo

Drop the logo PNG at **`docs/assets/the-called-logo.png`** and re-run the build — it's picked
up automatically and placed in the banner of every tab. No flag needed. To use a different
file: `python3 scripts/build_scoreboard.py --logo path/to/logo.png`.

Until that file exists the banner just carries its left padding, which looks deliberate rather
than broken, so the sheet is usable either way.

---

## Colour

Base palette is sampled from the logo — warm pewter and graphite on near-black. Because that's
a hueless brand and a sheet of grey numbers reads dead, **soft sand `#D4B579` carries the
accent**: section bands, callouts, the Target column and today's row, with `#EFE1C6` as its
tint. Saturated brass `#C8931A` is now reserved for the chart series and the hero-tile numbers,
where it sits on a dark fill and needs the punch.

The four chart hues — brass `#C8931A`, teal `#0D8F7A`, terracotta `#C4552B`, indigo
`#4A55A8` — were validated together for colour-blind separation (worst adjacent pair ΔE 11.2
under deuteranopia, normal-vision floor 21.4). **Re-run the validator before changing any of
them**, or two series can become indistinguishable for ~8% of men.

Green and red stay green and red. They're functional signals, not decoration — warmed to sit
with the palette, but never pushed toward brass.

---

## The seven tabs, in the order a client meets them

| # | Tab | Types here? | What it does |
|---|---|---|---|
| — | **Start Here** | No | Five numbered steps in the order they're done, the rules, an example row, Loom links. |
| 1 | **Setup** | Once | Name, coach, handle, start date, the four daily standards, monthly cash goal. Start date sets every date in the Daily Log. |
| 2 | **Daily Log** | Every day | 366 dated rows. **Today's row auto-highlights in brass.** Full funnel, green/red against standards, scores each day out of 4, and runs two streak counters. |
| 3 | **This Week** | No | What you've done, where you should be by now, ahead/behind, next week's aim — plus the "fix this first" callout. |
| 4 | **KPI Dashboard** | No | Five hero tiles, five time windows, seven conversion rates, standards vs target, four charts. |
| 5 | **Instagram Tracker** | Weekly + monthly | 53 weeks of follower/reach numbers with growth and quality ratios. Posts and stories auto-fill from the Daily Log. Monthly screenshot drop zone. |
| — | **Cheat Sheet** | The ranges | What every number means, what a low one is telling you, and what to do about it. Healthy ranges live here in editable cells and drive the dashboard's colour rules. |
| — | **Weekly Rollup** | No | Rolling last 13 weeks. Feeds the dashboard charts. |

Daily standards ship at **5 reels · 5 stories · 20 opener DMs · 10 follow-up DMs**, editable
per client on Setup.

### The Cheat Sheet tab

The tab that makes the rest of the sheet worth filling in. For each of the five rates: what it
measures, what a low reading actually means, exactly what to do about it, and the trap that
comes with a high one. Then the volume numbers, the money numbers, the Instagram numbers, and
five traps worth knowing before someone over-reacts to one bad week.

The same content is generated as [`Cheat_Sheet_for_Notion.md`](Cheat_Sheet_for_Notion.md) —
markdown tables that paste straight into a Notion page. Both outputs render from
`scripts/scoreboard_content.py`, so **edit the content there and the sheet and the Notion page
stay in step.** Editing either output directly is how they drift.

**The healthy ranges are editable cells, and they're wired in.** Floor and ceiling for each
rate live on the Cheat Sheet (cream cells, columns C and D, rows 11–15). The KPI Dashboard
mirrors the floor column into its own Target column and colours every rate against it — so
changing a floor there re-grades the dashboard, with no rebuild.

They are The Called's own numbers, set from what the team actually sees: **reply 50–80%, pitch
25–40%, book 60–80%, show 70–90%, close 40–70%**. Deliberately demanding — a client sitting
under them is meant to notice. Revisit as the client base grows, and change them in
`scripts/scoreboard_content.py` so the sheet and the Notion page move together.

### The This Week tab

The Monday ritual, and the thing worth screenshotting into a coaching call.

- **The work you control** — each standard: this week so far, your target for end of today
  (standard × days elapsed, so a Wednesday is judged against three days, not seven), ahead/behind, weekly target,
  % of pace, and next week's aim per day.
- **The result that follows** — DMs, replies, pitched, booked, showed, closes, cash: this week
  against last week, with the change.
- **Your rates vs your own 13-week average** — no external benchmark, no argument about what a
  "good" reply rate is. Only whether *you* dropped.
- **Two callouts at the top** — the standard you're furthest behind on, and the funnel step
  that fell furthest below your own average. Both are formulas, so they're never flattering.
  When every standard is at or ahead of pace the first one says so rather than manufacturing a
  problem.
- **Aim for next week** — its own section at the bottom: the metric to protect named in a
  sentence, then per-day and week-total targets for each standard with a one-line reason.

"Next week: aim per day" nudges up 10% on anything hit and holds the standard on anything
missed. It's a suggestion, not a rule — the standards themselves live on Setup.

---

## What changed from the Notion version, and why

| Notion today | The Scoreboard | Why |
|---|---|---|
| "Daily Tasks" and "Daily KPI Tracking" are the **same table twice** | One **Daily Log** (typed) + one **KPI Dashboard** (calculated) + a **This Week** review | Two identical pages meant entering the same numbers twice and nowhere that did maths. |
| Columns stopped at "calls booked" | Funnel runs through **showed → closes → cash collected → revenue** | Booked-but-no-show and showed-but-no-close are different problems with different fixes. Stopping at "booked" hides which one a client has. |
| Standards were text on the page | Standards live on Setup and drive green/red everywhere | Per-client targets, and the sheet grades the day instead of the client grading themselves. |
| Instagram Tracker was two screenshots | **Weekly numbers** (charted) **+ the monthly screenshots** | Screenshots are a coaching artefact, not data. Both kept. |
| Nothing rewarded consistency | **Day streak** and **perfect-day streak** on the dashboard | People protect a streak. It's the cheapest adherence mechanic there is. |
| No way to tell a stale sheet from a bad week | **"Last entry: …"** strip under the tiles, red past three days | A CSM pulling the sheet up on a call can see in one glance whether the numbers are current before reading a single one of them. |
| Numbers with no interpretation | **Cheat Sheet** tab | A rate nobody can read is just a number. This is what turns the sheet from a chore into a diagnostic. |

Column names match the Setter EOD base vocabulary (`Total Follow Ups Sent`, `Calls Pitched`,
`Calls Booked`, `Cash Collected`, `Revenue Generated`) so a client's numbers and a setter's
numbers mean the same thing side by side.

---

## Notion page descriptions — copy-paste

### Parent page — "Start Tracking Dashboards"

> Your tracking lives in one Google Sheet now — **The Scoreboard**.
>
> Click the link below, then **File → Make a copy** and save it to your own Drive. Fill in the
> Setup tab once and you're running. Each page below walks you through a part of it, and each
> one has a short video.
>
> Three jobs, that's the whole system:
> **Daily** — one row in the Daily Log, 60 seconds.
> **Weekly** — your Instagram numbers Sunday night, then two minutes on This Week come Monday.
> **Monthly** — two screenshots so your coach can audit your page.
>
> 🔗 Your Scoreboard: [paste the client's sheet link]

### "Daily Tasks"

> This is the one you touch every day.
>
> End of your day, open the **Daily Log** tab. Today's row is already highlighted — you don't
> have to hunt for it. Fill in what you actually did: reels, stories, opener DMs, follow-ups,
> replies, calls pitched, booked, showed, closed, and any cash collected. Sixty seconds.
>
> Hit your standard in a column and it goes green. Miss it and it goes red. Hit all four and
> the day scores 4/4 and your perfect-day streak goes up.
>
> **One rule that matters:** if you did none, type **0** — don't leave it blank. Blank tells the
> sheet you didn't track that day, and your averages end up flattering you.
>
> Your daily standards: **5 reels · 5 stories · 20 opener DMs · 10 follow-up DMs**

### "Daily KPI Tracking"

> You don't type anything on these pages — they read your Daily Log and do the maths.
>
> **Monday morning, open This Week.** It tells you what you've done, where you should be by
> now, and the one thing to fix — in a sentence, at the top, before any table. It also compares
> your rates to *your own* 13-week average, so nobody has to argue about what a good reply rate
> is. Only whether you dropped.
>
> **Before every coaching call, open the KPI Dashboard.** Five windows side by side — this week,
> last week, this month, last month, all time — so you can tell a real trend from one good day.
>
> The block that changes how you work is **Conversion Rates**:
>
> • Low **reply rate** → your opener is the problem, not your volume.
> • Low **book rate** → you're getting replies and not asking for the call.
> • Low **show rate** → it's a confirmation problem, not a booking problem.
> • Low **close rate** → it's the offer or the call, not the traffic.
>
> Same disappointing number at the bottom, four completely different fixes.

### "Instagram Tracker"

> Your Daily Log tracks the work. This tracks whether the account is actually growing.
>
> **Every Sunday night:** open Instagram → Professional Dashboard and log the week — followers,
> accounts reached, interactions, profile visits, new followers, link clicks. Posts and stories
> fill in automatically from your Daily Log, and the sheet works out your growth, your reach per
> post, and how many new followers you get per 1,000 accounts reached.
>
> That last number is the quality check: **reach going up while it goes down means you're being
> seen by the wrong people.**
>
> **First Sunday of the month:** screenshot your profile and your insights and drop them in the
> boxes at the top. That's what your coach audits — bio, offer, grid, and whether your
> positioning matches what the numbers say.

### "Content Planner"

Stays in Notion. The copy below assumes the six-stage pipeline from the internal **Content
Chamber** board (Idea → Scripting → Film → Needs edit → Ready → Posted).

> Every piece of content moves left to right across the board. Two boards, same six stages —
> one for Instagram, one for YouTube.
>
> **Idea** — a hook, a thought, a comment someone left you. No detail needed, just get it out of your head.
> **Scripting** — open the page and write the script. You don't film from an idea, you film from a script.
> **Film** — scripted and ready to shoot. Batch these; don't film one at a time.
> **Needs edit** — filmed, waiting on an edit.
> **Ready** — edited, ready to go out.
> **Posted** — done. Drag it over and move on.
>
> **Ready is the column that matters.** A stocked Ready column is the only reason consistent
> people stay consistent through a bad week. If Ready is empty, you're always one bad day away
> from missing your posts.
>
> **How to work it:** Sunday, twenty minutes — empty your head into Idea, move what's good into
> Scripting. Film in batches. Then you're never sitting down to "make content", you're just
> posting what's already Ready.
>
> You're not counting posts here — that's the Daily Log's job. This board only tells you what's
> next and where things are stuck.

---

## Loom scripts

Format: **[what you're doing on screen] → what you say.** Learn the first and last line, say
the middle in your own words. Four videos, matching the four link slots on the Start Here tab.

### Before you hit record

1. Record from **`The_Called_Scoreboard_DEMO.xlsx`**, not the blank template — 17 weeks of data
   with a real arc in it (see below), so every chart has shape and nothing reads zero.
2. Hide the bookmarks bar, close other tabs, clean Chrome profile.
3. Zoom to **110–125%**. Sheets text is unreadable on a phone at 100%.
4. Have the tab you're demoing already open before you start.
5. One take is fine. These get re-recorded when the sheet changes.

---

### Video 1 — Setup + Daily Log · target 3:00

**Open with:** *"This is your Scoreboard. One sheet, and it decides what we talk about on every call from here. Let's get you set up and logging in three minutes."*

| # | On screen | Say |
|---|---|---|
| 1 | The shared link → **File → Make a copy** | The one I sent you is read-only on purpose. Make a copy, name it your name plus Scoreboard, save it in your own Drive. |
| 2 | **Start Here** tab | Five steps in the order you do them. That's the whole system, top to bottom. |
| 3 | **Setup** tab | Two minutes, once. Name, coach, handle, and your start date — the start date sets every date in your log, so get it right the first time. |
| 4 | Point at the four standards | Five reels, five stories, twenty opener DMs, ten follow-ups. That's the floor, not the goal. Change these here and the whole sheet re-grades itself. |
| 5 | **Daily Log** tab | One row per day, dates already filled. You only type in the cream cells. |
| 6 | Point at today's highlighted row | Today's row lights up brass. You never have to go hunting for where you are. |
| 7 | Point at the brass strip in row 2 | Your standard for each column, sitting right above where you type. |
| 8 | Fill today's row live, left to right | Reels, stories, opener DMs, follow-ups, replies, pitched, booked, showed, closed, cash, revenue, follower count. |
| 9 | Type one under target → goes red → fix it | Green means you hit it. Red means you didn't. Not judgement, just honest. |
| 10 | Point at Standards Hit, then the two streak columns | Scores your day out of four. Four out of four is a perfect day — and the dashboard counts how many you've strung together. |
| 11 | Point at a `0` beside a blank cell | If you did none, type zero. Don't leave it blank. Blank means "didn't track", and then your averages flatter you. |

**Close with:** *"Sixty seconds a day. Do that, and the next video shows you what it turns into."*

---

### Video 2 — This Week + KPI Dashboard · target 3:30

**Open with:** *"You don't type anything on either of these pages. They read your Daily Log and do the maths. This is what we'll both be looking at on every call."*

| # | On screen | Say |
|---|---|---|
| 1 | **This Week** tab, top callouts | Monday morning, start here. Two lines at the top: the standard you're furthest behind on, and the step in your funnel that's dropped furthest below your own average. |
| 2 | Point at the second callout | Notice it's your average, not some industry benchmark. We're not arguing about what a good reply rate is — only whether yours fell. |
| 3 | **The work you control** table | This week so far, your target for end of today, and ahead or behind. On a Wednesday it holds you to three days of standard, not seven — so it's fair mid-week. |
| 4 | Point at "Next week: aim per day" | Hit it, it nudges up ten percent. Miss it, it holds. Your actual standards live on Setup. |
| 5 | **The result that follows** table | This week against last week. You'll see this move a week *after* the work moves — that lag is normal, don't panic in the middle of it. |
| 5b | Scroll to **Aim for next week** | One line naming the thing to protect, then per-day and weekly targets. That's your Monday planning done. |
| 6 | **KPI Dashboard** tab, hero tiles | Cash this month, percent of goal, calls booked this week, and your two streaks. |
| 7 | Sweep the five period columns | This week, last week, this month, last month, all time. That's how you tell a trend from one good day. |
| 8 | **Conversion Rates** — slow down here | Every one of these is a step in the chain. Low reply rate is a DM problem. Low book rate means you're getting replies and not asking. Low show rate is a confirmation problem, not a booking problem. Low close rate is the offer or the call. |
| 9 | Point at **Cash per 100 DMs Sent** | My favourite number on the page. What a hundred DMs is worth to you in dollars. Once you know it, sending twenty more stops being a chore and starts being a decision. |
| 10 | Standards block + Target column | Your averages against your standards. Green you're holding, red you're not. |
| 11 | Scroll to the four charts | Last thirteen weeks. They fill in as you go. |
| 12 | Open the **Cheat Sheet** tab | Any number on that dashboard you don't recognise, it's explained here — what it means when it's low, and exactly what to do about it. Read it once now, then come back whenever something looks wrong. |

**Close with:** *"Nothing on these pages is an opinion. And if a number looks wrong, the fix is in the Daily Log — not here."*

---

### Video 3 — Instagram Tracker · target 2:00–2:30

**Open with:** *"Your Daily Log tracks the work you did. This page tracks whether the account is actually growing off the back of it."*

| # | On screen | Say |
|---|---|---|
| 1 | Scroll to **Weekly Numbers** | Sunday night, five minutes, once a week. |
| 2 | Phone or second window: Instagram → Professional Dashboard | This is where every one of these numbers comes from. |
| 3 | Fill a week live | Followers, accounts reached, interactions, profile visits, new followers, link clicks. |
| 4 | Point at the grey columns | Posts and stories fill themselves from your Daily Log. Growth, growth percent, reach per post — all automatic. Don't type in grey. |
| 5 | Point at **New Followers per 1k Reached** | The quality number. Reach going up while this goes down means you're getting seen by the wrong people — that's a hook and positioning problem, not a volume problem. |
| 6 | Scroll to the monthly screenshot block | First Sunday of the month: screenshot your profile, screenshot your insights, click the box, then Insert → Image → **Image in cell**. |
| 7 | Say why | That's what I audit — bio, offer, grid, and whether your positioning matches what your numbers are telling us. |
| 8 | Point at the two charts | Follower growth and weekly reach. Empty now, full in a month. |

**Close with:** *"Five minutes on a Sunday. That's the whole thing."*

---

### Video 4 — Content Planner · target 2:00

**Open with:** *"This one stays in Notion, and it's the only page that isn't about numbers. This is where content actually gets made."*

| # | On screen | Say |
|---|---|---|
| 1 | Show both boards | Two boards, Instagram and YouTube, same six columns. |
| 2 | Walk the columns left to right | Idea, Scripting, Film, Needs edit, Ready, Posted. Content only ever moves one direction. |
| 3 | Open a card in Scripting | Every card is a page. The script lives inside it, so when you sit down to film you're reading, not writing. |
| 4 | Drag a card from Film to Needs edit | You move the card when the work's done. That's the whole system. |
| 5 | Point at **Ready** — slow down here | This column is the one I'll ask you about. A stocked Ready column is the only reason people stay consistent through a bad week. Empty Ready means you're one bad day from missing your posts. |
| 6 | Point at Idea | Sunday, twenty minutes: empty your head into Idea, move the good ones into Scripting. |
| 7 | Say what it's *not* | You're not counting posts here — that's your Daily Log. This board tells you what's next and where you're stuck, nothing else. |

**Close with:** *"Film in batches, keep Ready stocked, and posting stops being a decision you make every day."*

---

## The demo file — what's in it and how to use it

`The_Called_Scoreboard_DEMO.xlsx` is 17 weeks of data built as a story, because a demo of a
tracker full of noise proves nothing. The arc:

| Weeks | What happens | What the sheet shows |
|---|---|---|
| 1–5 | Holding the standard, building | ~200 DMs/week, 17–20% reply rate, $2–6k weeks |
| 6–9 | **Follow-ups collapse** — they get busy with delivery | DMs fall to ~125, reply rate drops to 12%, **four straight weeks of zero cash** |
| 10–11 | Coach catches it, follow-ups restart | Reply rate back to 14–17%, first close in a month |
| 12–17 | Recovery, better than the start | 220+ DMs/week, 21–23% reply rate, book rate 31–41% |

The final week is deliberately awkward in a useful way: **all four standards read green, and the
close rate still falls 36% below their own average.** That's the whole pitch in one screen —
someone doing the work, and the sheet finding the thing quietly costing them money anyway.
Nothing about effort would have surfaced that.

The demo's dates are relative to whenever it's opened, so the dashboard, This Week and the
streaks are always populated. Weekday alignment is set at build time, so weekends drift by a
day for each day after the build — re-run `--demo` before a big sales push if that matters.

**It is marked as reference-only on every tab.** Row 1 of all eight tabs carries a terracotta
`DEMO · … · SAMPLE DATA — REFERENCE ONLY` banner, every tab is coloured terracotta, and the
Start Here intro says plainly not to work in it. That's deliberate: the failure mode is a
prospect copying the *demo*, logging real numbers, and burying their own data under six weeks
of fiction. The marking is applied to row 1 rather than by inserting a warning row, so no
formula shifts.

**Using it in a sales conversation:** open This Week first (the callouts do the talking), then
the Cheat Sheet for the rate they just asked about, then the dashboard charts for the arc.
Don't open the Daily Log first — a year of empty rows is the least persuasive part of it.

---

## Rollout SOP

**One-time, on the master:**

1. Drop the logo at `docs/assets/the-called-logo.png` and re-run the build so the banners carry it.
2. Upload `The_Called_Scoreboard.xlsx` to the team Drive.
3. Open it → **File → Save as Google Sheets**. *(Do this first — conditional formatting, data
   validation and charts only behave properly once it's a real Google Sheet, not an
   Office-compatibility file.)*
4. Rename it **`TEMPLATE — The Scoreboard`** and delete the uploaded .xlsx.
5. Lock the calculated ranges — **Data → Protect sheets and ranges**, each set to "Only you":
   - `Daily Log`: columns **A:B** and **O:T**
   - `This Week`: whole tab
   - `KPI Dashboard`: whole tab
   - `Weekly Rollup`: whole tab
   - `Instagram Tracker`: columns **A**, **C:D**, **J:M**
   - `Setup`: row 9 only
   - `Cheat Sheet`: everything **except** C11:D15 (the healthy ranges stay editable)

   Copies inherit protection, so doing it once on the master covers every client.
6. Record the four Looms and paste the links into the Start Here tab of the master.

**Per client, at onboarding:**

1. **File → Make a copy** → name `[Client Name] — Scoreboard` → save into the `Client Scoreboards` folder.
2. Fill in Setup: name, coach/CSM, handle, start date. Adjust standards if their programme differs.
3. Share: **client = Editor**, the folder = **Viewer** for coaches and CSMs.
4. Paste the sheet URL into the client's record in Airtable (`The Called — Client Success` →
   Clients → add a **Scoreboard URL** field if it doesn't exist) so a CSM can open it before a
   call without hunting through Drive.
5. Send them the Notion parent page with their link in it.
6. If they want to see it populated first, send the demo as a **view-only** link and say out
   loud that it's a sample. It's marked on every tab, but say it anyway.

---

## Changing the workbook

Edit `scripts/build_scoreboard.py` and re-run it — never hand-edit the .xlsx, the next run
overwrites it. Brand colours are the `PALETTE` dict at the top.

```bash
python3 scripts/build_scoreboard.py          # template + the Notion cheat sheet markdown
python3 scripts/build_scoreboard.py --demo   # the reference / recording copy
```

Cheat-sheet wording lives in `scripts/scoreboard_content.py` and renders into both the workbook
tab and the Notion markdown. Change it there, never in the outputs.

After a change, verify the formulas actually evaluate:

```bash
pip install formulas
python3 - <<'EOF'
import formulas
for f in ("docs/The_Called_Scoreboard.xlsx", "docs/The_Called_Scoreboard_DEMO.xlsx"):
    sol = formulas.ExcelModel().loads(f).finish().calculate()
    bad = [k for k, v in sol.items() if str(getattr(v, "value", v)).startswith("#")]
    print(f, len(sol), "cells,", len(bad), "errors")
EOF
```

(The `xlsx` skill's `recalc.py` drives LibreOffice, which doesn't run in this environment;
`formulas` does the same job in-process.)

---

## Known limits — worth knowing before a client asks

- **One year.** The Daily Log covers 366 days from the start date and the Instagram tab 53
  weeks. At the year mark, copy the last row down (the formulas carry) or hand them a fresh
  copy — a deliberate call not to double every SUMIFS range for a deadline most clients won't
  reach.
- **Don't delete columns.** Hiding is safe, deleting breaks the dashboard with `#REF!`.
- **Protection doesn't survive the .xlsx import** — apply it in Sheets, on the master, after
  conversion. Step 5 above.
- **Charts show a rolling 13 weeks**, not everything since the start. Deliberate: a fixed
  52-week chart is mostly empty space for the first six months.
- **Weeks run Monday–Sunday** everywhere, including "This Week".
- **Show rate can exceed 100% on a one-week view.** A call booked Friday is shown Monday, so
  inside a fixed 7-day window the shows can outnumber that window's bookings. Real behaviour,
  not a bug — it settles over the month and all-time columns, and the Cheat Sheet says so where
  a client would go looking.
- **Streaks tolerate today being blank.** They read yesterday's value until today is logged, so
  logging at 9pm doesn't look like a broken streak all day.
- **"Fix this first" needs three weeks** of data before the funnel line means anything; until
  then it says so rather than inventing a conclusion.
- **No automatic link to Airtable or Discord.** If we later want weekly numbers flowing into the
  Client Success base, that's a build on the automation hub, not a formula.
