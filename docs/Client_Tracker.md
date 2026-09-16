# Client Tracker — Google Sheets build, Notion copy & Loom scripts

Replaces the Notion tracking dashboards with one Google Sheet per client.
Built file: [`The_Called_Client_Tracker.xlsx`](The_Called_Client_Tracker.xlsx) ·
recording copy with sample data: [`The_Called_Client_Tracker_DEMO.xlsx`](The_Called_Client_Tracker_DEMO.xlsx) ·
regenerate either with `python3 scripts/build_client_tracker.py [--demo]`.

**Content Planner stays in Notion.** Boards, calendar views and per-post script pages are
things Notion does better than Sheets, and we already have a working version. Nothing in this
build touches it.

---

## What changed from the Notion version, and why

**Brand colours** are sampled from the logo — warm pewter and graphite on near-black
(`#1B1916` banners, `#3A3833` headings, `#E1DFDB` section strips). They live in the `PALETTE`
dict at the top of the build script. The only non-brand colours in the workbook are the
green/red hit-or-miss signals, which stay green and red on purpose.

**One thing to fix in Notion while you're in there:** the client-facing Content Planner and the
internal Content Chamber use different column names — `To Film / To Edit / To Post` versus
`Film / Needs edit / Ready / Posted`. Worth standardising the client board on the Content
Chamber's six stages. `Ready` as its own stage is the useful part (a buffer of ready-to-post
content is what keeps people consistent), and `Needs edit` says who's waiting on whom in a way
`To Edit` doesn't. Keep the client board's Calendar and Posted This Month views — the internal
board doesn't have them and they're worth having.

| Notion today | Google Sheet | Why |
|---|---|---|
| "Daily Tasks" and "Daily KPI Tracking" are the **same table twice** — same columns, same video, same standards | One **Daily Log** (the only place anything is typed) + one **KPI Dashboard** (100% calculated) | Two identical pages meant two places to enter the same numbers and nowhere that did maths. Now each Notion page points at a tab that does a genuinely different job. |
| Columns stopped at "calls booked" | Funnel runs through **showed → closes → cash collected → revenue** | Booked-but-didn't-show and showed-but-didn't-close are completely different problems with completely different fixes. Stopping at "booked" hides which one a client has. |
| Standards were text on the page | Standards live on **Setup** and drive green/red on every row | Per-client targets, and the sheet grades the day instead of the client grading themselves. |
| Instagram Tracker was two screenshots | **Weekly numbers** (charted) **+ the monthly screenshots** | Screenshots are a coaching artefact, not data. Kept both — numbers for trend, screenshot for the bio/offer audit. |

Column names match the Setter EOD base vocabulary (`Total Follow Ups Sent`, `Calls Pitched`,
`Calls Booked`, `Cash Collected`, `Revenue Generated`) so a client's numbers and a setter's
numbers mean the same thing when they land side by side.

---

## The six tabs

| Tab | Client types here? | What it does |
|---|---|---|
| **Start Here** | No | What the sheet is, the three jobs, the rules, an example row, and slots for the three Loom links. |
| **Setup** | Once | Name, coach, handle, start date, the four daily standards, monthly cash goal. Start date sets every date in the Daily Log. |
| **Daily Log** | Daily | 366 dated rows. Reels, stories, opener DMs, follow-ups, replies, pitched, booked, showed, closes, cash, revenue, followers, notes. Green/red against standards; scores each day out of 4. |
| **KPI Dashboard** | No | This week / last week / this month / last month / all time. Activity, sales, five conversion rates, cash per 100 DMs, averages vs target, perfect days, monthly goal box, four charts. |
| **Instagram Tracker** | Weekly + monthly | 53 weeks of follower/reach/interaction numbers with growth %, reach per post and new followers per 1k reached. Posts and stories auto-fill from the Daily Log. Monthly screenshot drop zone at the top. |
| **Weekly Rollup** | No | Rolling last 13 weeks. Feeds the dashboard charts. |

---

## Notion page descriptions — copy-paste

### Parent page — "Start Tracking Dashboards"

> Everything you track now lives in one Google Sheet instead of four Notion pages.
>
> Click the tracker link below, then **File → Make a copy** and save it to your own Drive.
> Fill in the Setup tab once — your name, your start date, your daily standards — and you're
> running. The pages below walk you through each part, and each one has a short video.
>
> Three jobs, that's the whole system:
> **Daily** — one row in the Daily Log, 60 seconds.
> **Weekly** — your Instagram numbers, Sunday night, 5 minutes.
> **Monthly** — two screenshots so your coach can audit your page.
>
> 🔗 Your tracker: [paste the client's sheet link]

### "Daily Tasks"

> This is the one you touch every day.
>
> End of your day, open the **Daily Log** tab, find today's row, and fill in what you actually
> did: reels, stories, opener DMs, follow-ups, replies, calls pitched, booked, showed, closed,
> and any cash collected. Sixty seconds.
>
> Hit your standard in a column and the cell goes green. Miss it and it goes red. Hit all four
> and the day scores 4/4.
>
> **One rule that matters:** if you did none, type **0** — don't leave it blank. Blank tells the
> sheet you didn't track that day, and your averages end up flattering you.
>
> Your daily standards: **4 posts · 30 stories · 10 opener DMs · 10 follow-up DMs**

### "Daily KPI Tracking"

> You don't type anything on this page — it reads your Daily Log and does the maths.
>
> Open the **KPI Dashboard** tab on Monday morning and before every call with your coach. It
> shows this week, last week, this month, last month and all time side by side, so you can tell
> a real trend from one good day.
>
> The block that changes how you work is **Conversion Rates**. Reply rate, pitch rate, book
> rate, show rate, close rate — each one is a step in the chain, and when cash is down, one of
> them is the reason:
>
> • Low **reply rate** → your opener is the problem, not your volume.
> • Low **book rate** → you're getting replies and not asking for the call.
> • Low **show rate** → it's a confirmation problem, not a booking problem.
> • Low **close rate** → it's the offer or the call, not the traffic.
>
> Same disappointing number at the bottom, four completely different fixes. That's what this
> page is for.

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
> boxes at the top of the tab. That's what your coach audits — bio, offer, grid, and whether
> your positioning matches what the numbers say.

### "Content Planner"

Stays in Notion — Sheets can't do boards, calendars and per-post script pages, and Notion does
all three well. The copy below assumes the six-stage pipeline from the internal **Content
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
the middle in your own words.

### Before you hit record (all three videos)

1. Record from **`The_Called_Client_Tracker_DEMO.xlsx`**, not the blank template — it's got
   three weeks of realistic data in it, so no dashboard shows a screen of zeros or `#DIV/0`.
2. Hide the bookmarks bar, close other tabs, and use a clean Chrome profile — a client
   screenshotting your tab bar is a bad look.
3. Zoom the browser to **110–125%**. Sheets text is unreadable on a phone at 100%.
4. Have the tab you're about to demo already open before you start recording.
5. One take is fine. These get re-recorded when the sheet changes, so don't polish.

---

### Video 1 — Daily Log · target 2:30–3:00

**Open with:** *"This is your tracker. One sheet, three things you ever touch, and it does the maths for you. Let's start with the one you'll use every single day."*

| # | On screen | Say |
|---|---|---|
| 1 | Start Here tab | One sheet replaces the four Notion pages. Three jobs: daily, weekly, monthly. |
| 2 | Click **Setup** | Do this once. Name, coach, handle, and your start date — the start date sets every date in the log, so get it right the first time. |
| 3 | Point at the four standards | These are your standards: 4 posts, 30 stories, 10 openers, 10 follow-ups. Change them here and the whole sheet re-grades itself. |
| 4 | Click **Daily Log** | One row per day, dates already filled in. You only ever type in the cream cells. |
| 5 | Point at the purple strip in row 2 | That's your target for each column, sitting right above where you type, so you're never guessing. |
| 6 | Fill today's row live, left to right | Reels, stories, opener DMs, follow-ups, replies, pitched, booked, showed, closed, cash, revenue, follower count. |
| 7 | Type something under target → goes red → fix it | Green means you hit it. Red means you didn't. It's not judgement, it's just honest. |
| 8 | Point at **Standards Hit** | Scores the day out of four. Four out of four is a perfect day — the dashboard counts those. |
| 9 | Point at a `0` next to a blank cell | If you did none, type zero. Don't leave it blank. Blank means "didn't track", and then your averages flatter you. |
| 10 | Point at **Notes** | Context for later — sick day, launch day, whatever explains a weird number three weeks from now. |

**Close with:** *"Sixty seconds a day. Do that, and the next video shows you what it turns into."*

---

### Video 2 — KPI Dashboard · target 3:00

**Open with:** *"You don't type anything on this page. It reads your Daily Log and does the maths for you. This is the page you open Monday morning, and the page we'll both be looking at on our calls."*

| # | On screen | Say |
|---|---|---|
| 1 | Sweep across the five column headers | This week, last week, this month, last month, all time. Same numbers, five windows — that's how you tell a real trend from one good day. |
| 2 | **Activity** block | What you put in. Posts, stories, DMs, replies. |
| 3 | **Sales** block | What it turned into. Pitched, booked, showed, closed, cash, revenue. |
| 4 | **Conversion Rates** block — slow down here | This is the block that changes how you work. Every one of these is a step in the chain. |
| 5 | Point at reply rate, then book rate, then show rate, then close rate | Low reply rate is a DM problem. Low book rate means you're getting replies and not asking. Low show rate is a confirmation problem, not a booking problem. Low close rate is the offer or the call. Same low cash number, four different fixes — this tells you which one you've got. |
| 6 | Point at **Cash per 100 DMs Sent** | My favourite number on the page. What a hundred DMs is worth to you in dollars. Once you know it, sending ten more DMs stops being a chore and starts being a decision. |
| 7 | **Daily Standards** block + the Target column on the right | Your averages against your standards. Green, you're holding the line. Red, you're not. Perfect Days counts your 4/4 days, and Standards Hit Rate is the percentage. |
| 8 | Goal box, top right | Your monthly cash goal, what you've collected, how far in you are, days left in the month. |
| 9 | Scroll to the four charts | Last thirteen weeks. DMs against replies, calls booked against closes, cash per week, and your rates over time. These fill in as you go. |

**Close with:** *"Nothing on this page is an opinion. And if a number looks wrong, the fix is in the Daily Log — not here."*

---

### Video 3 — Instagram Tracker · target 2:00–2:30

**Open with:** *"Your Daily Log tracks the work you did. This page tracks whether the account is actually growing off the back of it."*

| # | On screen | Say |
|---|---|---|
| 1 | Scroll to **Weekly Numbers** | Sunday night, five minutes, once a week. |
| 2 | Phone or second window: Instagram → Professional Dashboard | This is where every one of these numbers comes from. |
| 3 | Fill a week live | Followers, accounts reached, interactions, profile visits, new followers, link clicks. |
| 4 | Point at the grey columns | Posts and stories fill themselves in from your Daily Log. Growth, growth percent, reach per post — all automatic. Don't type in grey. |
| 5 | Point at **New Followers per 1k Reached** | This is the quality number. Reach going up while this goes down means you're getting seen by the wrong people — that's a hook and positioning problem, not a volume problem. |
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

**Close with:** *"Film in batches, keep Ready stocked, and posting stops being a decision you have to make every day."*

---

### Video 0 — "Make your copy" · target 60–90 seconds *(optional, for the parent page)*

**Open with:** *"Before anything else — thirty seconds to get your own copy, because the one I'm sending you is read-only on purpose."*

| # | On screen | Say |
|---|---|---|
| 1 | Open the shared link | This is the master. You can't break it and you can't type in it. |
| 2 | **File → Make a copy** | Make a copy, name it your name plus "Tracker", save it in your own Drive. |
| 3 | Open the copy → **Setup** tab | Fill in these cream cells. Start date is today — or the Monday you're starting, if you want to start clean. |
| 4 | Click **Daily Log** | Dates fill in from what you just typed. |
| 5 | Back to Start Here | Paste your copy's link back to me in Discord so I can see your numbers before our calls. |

**Close with:** *"That's setup done — you'll never touch that tab again."*

---

## Rollout SOP

**One-time, on the master:**

1. Upload `The_Called_Client_Tracker.xlsx` to the team Drive.
2. Open it → **File → Save as Google Sheets**. *(Do this before anything else — conditional
   formatting, data validation and charts only behave properly once it's a real Google Sheet,
   not an Office-compatibility file.)*
3. Rename it **`TEMPLATE — The Called Client Tracker`** and delete the uploaded .xlsx.
4. Lock the calculated ranges so clients can't blow up the formulas —
   **Data → Protect sheets and ranges**, set each to "Only you":
   - `Daily Log`: columns **A:B**, **O:Q**
   - `KPI Dashboard`: whole tab
   - `Weekly Rollup`: whole tab
   - `Instagram Tracker`: columns **A**, **C:D**, **J:M**
   - `Setup`: row 9 only
   Copies inherit protection, so doing it once on the master covers every client.
5. Record the Looms and paste the links into the Start Here tab of the master.

**Per client, at onboarding:**

1. **File → Make a copy** → name `[Client Name] — Tracker` → save into the `Client Trackers`
   folder.
2. Fill in Setup: client name, coach/CSM, Instagram handle, start date. Adjust standards if
   their programme is different.
3. Share the copy: **client = Editor**, the `Client Trackers` folder = **Viewer** for coaches
   and CSMs.
4. Paste the sheet URL into the client's record in Airtable (`The Called — Client Success` →
   Clients → add a **Tracker URL** field if it doesn't exist yet) so a CSM can open it before a
   call without hunting through Drive.
5. Send them the Notion parent page with their sheet link in it.

---

## Changing the workbook

Edit `scripts/build_client_tracker.py` and re-run it — never hand-edit the .xlsx, the next
run overwrites it. Brand colours are the `PALETTE` dict at the top of the script.

```bash
python3 scripts/build_client_tracker.py          # the template
python3 scripts/build_client_tracker.py --demo   # the recording copy
```

After a change, verify the formulas actually evaluate:

```bash
pip install formulas
python3 - <<'EOF'
import formulas
for f in ("docs/The_Called_Client_Tracker.xlsx", "docs/The_Called_Client_Tracker_DEMO.xlsx"):
    sol = formulas.ExcelModel().loads(f).finish().calculate()
    bad = [k for k, v in sol.items()
           if str(getattr(v, "value", v)).startswith("#")]
    print(f, len(sol), "cells,", len(bad), "errors")
EOF
```

Both files currently evaluate clean — 4,442 and 4,826 cells, zero errors — and the dashboard
totals, all five conversion rates, cash per 100 DMs and the perfect-days count were checked
against the demo data by hand. (The `xlsx` skill's `recalc.py` needs LibreOffice, which doesn't
run in this environment; `formulas` does the same job in-process.)

## Known limits — worth knowing before a client asks

- **366 days.** The Daily Log covers a year from the start date. At the year mark, either add
  rows (copy the last row down — the formulas carry) or hand them a fresh copy.
- **Don't delete columns.** Hiding is safe, deleting breaks the dashboard with `#REF!`. It's in
  the Start Here rules and in Video 1 for a reason.
- **Protection doesn't survive the .xlsx import** — it has to be applied in Sheets, on the
  master, after conversion. That's step 4 above.
- **Charts show a rolling 13 weeks**, not everything since the start. Deliberate: a fixed
  52-week chart is mostly empty space for the first six months.
- **Weeks run Monday–Sunday** everywhere, including "This Week" on the dashboard.
- **No automatic link to Airtable or Discord.** Each client's numbers stay in their own sheet.
  If we later want weekly numbers flowing into the Client Success base automatically, that's a
  real build on the automation hub, not a formula.
