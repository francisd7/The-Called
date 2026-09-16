"""Cheat-sheet content for The Scoreboard.

Single source of truth. `build_scoreboard.py` renders this into the Cheat Sheet
tab of the workbook, and `--notion` renders the same data as a markdown file to
paste into Notion. Edit here and both outputs stay in step.
"""

INTRO = [
    "Your business is a chain. Content gets you seen. Stories build trust. Opener DMs start "
    "conversations. Follow-ups rescue the ones that stalled. Replies become pitches, pitches "
    "become booked calls, booked calls become clients.",
    "Every link has a rate. When the money is down, one link broke — and the rates tell you "
    "exactly which one. That is the entire point of this sheet: stop guessing, fix one thing.",
    "Rule of thumb: fix the earliest broken link first. Working on your close rate while your "
    "reply rate is broken just means closing a smaller number of people.",
]

RATES = [
    dict(
        name="Reply rate",
        formula="Replies ÷ DMs sent",
        floor=0.10, ceiling=0.25,
        measures="Whether your opener is worth answering. Nothing downstream can beat this number.",
        low="Your opener reads like a pitch, or you're messaging people who have never seen you. "
            "Cold list, or a first line about you instead of them.",
        do="Rewrite the first line so it's about them — something specific from their profile or "
           "content. Warm the list first: watch stories and reply to posts for 2–3 days before "
           "the DM. Change ONE thing and give it 50 DMs before you judge it.",
        high="Good — but check your pitch rate. A high reply rate with a low pitch rate means "
             "you're being liked, not hired. Pleasant conversations are not pipeline.",
    ),
    dict(
        name="Pitch rate",
        formula="Calls pitched ÷ replies",
        floor=0.30, ceiling=0.60,
        measures="Whether you actually ask. This is the most common place the whole thing quietly dies.",
        low="You're chatting. Either you're scared of the ask, or you don't have a clean line to "
            "get from conversation to call.",
        do="Decide the ask before you open the conversation. Two exchanges, then transition. "
           "Write one transition line, save it, and use it every time until it feels boring.",
        high="Check your book rate. If you're pitching almost everyone and few are booking, "
             "you're asking before you've earned it.",
    ),
    dict(
        name="Book rate",
        formula="Calls booked ÷ pitched",
        floor=0.20, ceiling=0.40,
        measures="Whether the ask lands when you make it.",
        low="Three usual causes: asking too early, an unclear offer, or pitching people who were "
            "never going to buy.",
        do="Qualify before you ask — do they actually have the problem you solve, and can they "
           "pay? Make the call sound like a specific outcome, not “a quick chat”. Offer "
           "two times, not an open calendar.",
        high="Your ask works. The bottleneck is upstream — send more DMs.",
    ),
    dict(
        name="Show rate",
        formula="Calls showed ÷ booked",
        floor=0.60, ceiling=0.85,
        measures="Whether the booking was real. This is a confirmation problem, almost never a "
                 "booking problem.",
        low="Most no-shows booked in a moment of interest and then forgot. The gap between "
            "booking and call is where it died.",
        do="Book inside 48 hours — the further out, the colder. Confirm within an hour of booking "
           "and ask them to reply. Remind 24 hours before and again the morning of. A "
           "confirmation they don't reply to isn't a confirmation.",
        high="Your bookings are real. Push volume upstream. Over a single week this can read "
             "above 100% — a call booked on Friday gets shown on Monday, so inside a 7-day "
             "window the shows can outnumber the bookings. It is not a broken number. Judge "
             "show rate on the month or all-time column, never on one week.",
    ),
    dict(
        name="Close rate",
        formula="Closes ÷ showed",
        floor=0.20, ceiling=0.40,
        measures="The offer and the call itself — but only for the people who actually turned up.",
        low="Check book rate first. High book rate plus low close rate is a qualification problem, "
            "not a closing problem — you're booking the wrong people, and no call script fixes "
            "that. If qualification is fine, it's the call structure or the price framing.",
        do="Fix who's showing up before you fix the call. Then: diagnose longer before you "
           "present, and get the money objection on the table early rather than at the end.",
        high="Your offer works and the right people are showing. Every extra DM is now worth real "
             "money — look at Cash per 100 DMs and act on it.",
    ),
]

VOLUME = [
    dict(name="Reels / posts",
         does="Gets you in front of people who've never heard of you, and gives your DMs a reason "
              "to be answered.",
         low="Your DM volume has to do all the work, and your reply rate usually drops a week or "
             "two later.",
         do="Batch film. Content volume is a scheduling problem, not a creativity problem."),
    dict(name="Stories",
         does="The trust layer. Stories are why someone recognises your name when your DM lands.",
         low="Watch your reply rate about a week later — this is usually where a reply-rate drop "
             "starts.",
         do="Post through the day, not in one block. Behind the scenes, client wins, opinions. "
            "Low effort, high frequency."),
    dict(name="Opener DMs",
         does="The single biggest lever on how many calls you book. Everything downstream is a "
              "percentage of this number.",
         low="Nothing else matters much. A great reply rate on 5 DMs a day is still no pipeline.",
         do="Same time, every day, before anything else. Volume first, then optimise the opener."),
    dict(name="Follow-up DMs",
         does="Where most of the money is. Most replies come on the second or third touch, not "
              "the first.",
         low="You're paying full price for leads and then abandoning them. This is the cheapest "
             "fix in the whole sheet.",
         do="Every unanswered opener gets a follow-up 48 hours later, and another 4 days after "
            "that. Add value, don't just bump."),
    dict(name="Replies",
         does="An outcome, not an input. You don't control replies — you control DMs sent and how "
              "good the opener is.",
         low="Don't try to fix replies. Fix the opener (reply rate) or the volume (opener DMs).",
         do="—"),
]

MONEY = [
    dict(name="Cash per call booked",
         what="What one booked call is worth to you on average, including the ones that don't close.",
         use="Multiply it by the calls you didn't book this week. That's what the missed follow-ups "
             "cost you — in dollars, not vibes."),
    dict(name="Cash per 100 DMs sent",
         what="The number that turns your daily standard into a decision instead of a chore.",
         use="If 100 DMs is worth $1,200 to you, then 20 more DMs today is worth $240. That's the "
             "whole argument for hitting the standard."),
    dict(name="Cash collected vs revenue generated",
         what="Revenue is what they agreed to pay. Cash is what actually landed in your account.",
         use="A gap means payment plans or unpaid invoices. Neither is wrong — but manage your cash "
             "off the cash number, never the revenue number."),
]

INSTAGRAM = [
    dict(name="Followers",
         what="The least useful number on the page. Followers only matter if reach and DMs move "
              "with them.",
         watch="Accounts reached, and new followers per 1,000 reached."),
    dict(name="Accounts reached",
         what="How many people actually saw you this week. This is the real top of your funnel.",
         watch="If it's falling, post more or post differently — reach follows volume and hooks far "
               "more than it follows follower count."),
    dict(name="New followers per 1,000 reached",
         what="The quality number. How many people who saw you thought you were worth following.",
         watch="Falling while reach rises means you're being shown to the wrong people. A viral reel "
               "that brings the wrong audience makes your DMs worse, not better."),
    dict(name="Reach per post",
         what="How far the average post travels. Rising reach on flat post count is the good kind "
              "of growth.",
         watch="Compare it to reach — if reach is only up because you posted more, reach per post "
               "tells you the content itself didn't improve."),
]

TRAPS = [
    "One week is not a trend. Three weeks minimum before you change strategy off a number.",
    "A low close rate with a high book rate is a qualification problem, not a closing problem.",
    "Cash lags the work by two to four weeks. Don't panic in the middle of the lag — look at the "
    "activity numbers instead, they move first.",
    "Blank is not zero. A blank day tells the sheet you didn't track; a zero tells it you didn't "
    "work. Only one of those is honest.",
    "Don't fix two things at once. You'll never know which one worked, and you'll keep doing both "
    "forever.",
]
