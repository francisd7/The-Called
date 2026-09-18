# Channel content

Copy for the channels the structure script created empty. Written to be
pasted into Discord as-is — Discord renders `#`/`##` headers, `**bold**` and
`>` quotes.

Anything in `[square brackets]` needs a real value before posting.

Pin every one of these. `#start-here` is what a new client reads within about
thirty seconds of paying, so it is doing more work than any other channel here.

Note what a new client actually sees at that moment, as of 2026-09-18: they
arrive on Whop's own invite with **no tier role yet**, so the sidebar is four
read-only channels plus their own private channel, until someone assigns their
tier by hand. Tier assignment is a manual step — Whop's Discord app could not
be made to hand out our per-tier links.

---

## `#start-here` — two messages, posted back to back, both pinned

**Message 1 sets the standard. Message 2 is the reference.** Split because one
message would blow Discord's 2,000-character limit, and because they get read at
different moments: the first once, on day one; the second every time someone has
a thing and isn't sure where it goes.

Deliberately not a tour of the server. The sidebar already shows what the rooms
are; what it can't show is how a man is expected to use them, and that is the
thing worth pinning. An earlier draft walked the categories top to bottom and
duplicated the private-channel welcome message's to-do list — two different
to-do lists landing on the same client inside ten minutes.

The voice follows `src/onboarding/welcomeMessage.js` rather than a help desk.
That message opens "You didn't just sign up for a program. You stepped into a
brotherhood of men who are done playing small"; a `#start-here` that opens with
a productivity promise reads like a different company wrote it.

Read by all four tiers, by veterans, and by brand-new buyers with no tier role
yet — five audiences seeing between 4 and 20 channels. So it never says "you
have X." One line in message 2 carries the whole problem: *your sidebar only
shows what your package includes*. True for all five at once.

---

### Message 1 — the standard (1,226 characters)

You're in. Here's how men use this room.

**Post the specific version.**
"How do I get clients" gets you nothing. "I sent 40 DMs this week, 3 replied,
here's the exact message I used" gets you a real answer — from a coach, or from
the guy who solved it last month. Vague questions get vague answers.

**Post the number you don't want to post.**
The week that went badly is worth more in here than the week that went well.
Nobody in this room is impressed by a highlight reel, and every man here has had
the quiet month you're having right now. Said out loud, it stops running your
head.

**Show up for other men's wins.**
Read `#wins` even when you've got nothing to add — it's the fastest read in the
server on what's actually working this month. And the day you post yours, you'll
want men in there reading it.

**Do the work between the calls.**
The calls don't build the business. The five days between them do. This room
exists so those five days aren't spent on your own.

**You're not here to be a customer.**
You're here to become the man who doesn't need this anymore. Move like it from
day one.

Your own channel is down the sidebar with your name on it. Your first tasks are
already sitting in it. Start there.

---

### Message 2 — where does what go (1,442 characters)

**Where does what go?**

Your sidebar only shows what your package includes. If something below isn't in
yours, nothing's broken — it just isn't part of your package yet.

**Your own channel** — the one with your name on it. Your numbers, your
questions, anything personal, anything broken. You, your coach, nobody else. If
you only use one channel in here, use this one.

**`#wins`** — a result. A client closed, a post that popped, a number that
moved. Big or small, post it.

**`#content-review`** — something you built and want torn apart. Offer, script,
landing page, post.

**`#reel-ideas`** — stuck for angles, or you've got one worth stealing.

**`#the-forge-chat`** — thinking out loud with the other guys. The day-to-day
room.

**`#<your package>-chat`** — men at exactly your stage. Same week, same
problems.

**`#convo-reviews`** — a DM thread you want picked apart line by line.

**`#sales-general`** — anything about closing. **`#setting-general`** — anything
about outreach and booking.

**`#bible-study`** — faith, and the heavier stuff. 🔊 **Warrior Huddle** is the
live version of it.

**`#general-chat`** — everything else. Every level is in here.

Read-only, nothing to post: `#announcements`, `#book-1-1`, your package's
announcements channel, and anything ending in `-recordings`.

One rule that makes all of it work: **post the specific version.** Details get
answers. Vagueness gets silence.

---

## `#foundations-announcements`

> Read-only. Everything posted here applies to Foundations specifically.

This is where you'll see anything meant for Foundations and not the whole
server — call times, deadlines, new material, and changes that affect your
package.

Talk in `#foundations-chat`. Ask anything private in your own channel.

---

## `#momentum-announcements`

> Read-only. Everything posted here applies to Momentum specifically.

Momentum-only announcements land here — call times, deadlines, new material,
and anything that affects your package and not the rest of the server.

Momentum also opens up **TRAINING HUB**: sales and setting training, call
reviews, conversation reviews, and recordings. If you haven't been in there
yet, start with `#training-recordings`.

Talk in `#momentum-chat`. Ask anything private in your own channel.

---

## `#inner-circle-announcements`

> Read-only. Everything posted here applies to Inner Circle specifically.

Inner Circle announcements only — call times, deadlines, and anything meant
for this room and no one else.

You have access to everything in the server. Nothing is gated above you.

Talk in `#inner-circle-chat`. Ask anything private in your own channel.

---

## `#foundations-chat`

> Everyone in here is on Foundations. Same stage, same problems, same week.

Use this for the things that are too small for a call and too specific for the
main chat. What you're stuck on, what you tried, what worked.

The rule that makes this useful: **post the specific version.** "How do I get
clients" gets you nothing. "I sent 40 DMs this week, got 3 replies, here's the
message I used" gets you an actual answer — from a coach or from the guy who
solved it last month.

Start here: what are you working on this week, and what's in your way?

---

## `#inner-circle-chat`

> The smallest room in the server. Use it that way.

You're a handful of people at the top of the program, which means you can be
far more direct here than anywhere else — real numbers, real deals, real
problems you wouldn't post publicly.

What's worth posting: the decision you're weighing, the number that isn't
moving, the hire you're not sure about. What you'd normally only say on a
call.

Start here: what's the single biggest constraint on your business right now?

---

## Notes on posting these

- **`#start-here` first.** Post message 1, then message 2, then pin both.
- **Discord's single-message limit is 2,000 characters.** Message 1 is 1,226
  and message 2 is 1,442, so there is real headroom in each — but re-count
  before merging them, because together they are well over.
- Channel names are left in backticks rather than as real `#` mentions.
  Mentions would be clickable, but one pointing at a channel the reader can't
  see renders greyed out, and message 2 names channels most readers can't
  reach on purpose.
- `#start-here` names channels some readers can't see — `#convo-reviews` to a
  Foundations client, `#content-review` to a bible-study member. That is
  deliberate. "It just isn't part of your package **yet**" does the upsell
  quietly, without ever ranking anyone. Cut the word "yet" to turn it off.
- Message 1 ends by pointing at their own channel rather than listing tasks.
  The private-channel welcome message already carries the real first tasks
  (`src/onboarding/welcomeMessage.js`), and two to-do lists arriving inside ten
  minutes is how both get ignored.
- **Nobody is named in `#start-here`.** The welcome message already introduces
  Nigel, Francis, Andrew and Noah by mention, in the client's own channel,
  where it actually lands. A second roster here would go stale the first time
  someone leaves.
- The tier chats open with a question on purpose. An empty channel with a
  greeting in it stays empty; one with a question in it gets an answer.
- These deliberately avoid naming prices or tier positions. A client knows
  what they bought, and a chat that reads as a ranking discourages the people
  at the bottom of it from posting.

## What each audience actually sees

Regenerate with
`node -e "import('./src/discord/serverStructure.js').then(m=>console.log(m.visibleChannelsFor('Tier: Foundations')))"`.
This is why `#start-here` never says "you have X":

| Audience | Channels | Private channel |
|---|---|---|
| New buyer, no tier role yet | 4, all read-only, + their own | ✓ |
| Tier: The Called | 9 | ✗ |
| Veteran | 10 | ✗ |
| Tier: Foundations | 16 | ✓ |
| Tier: Momentum | 20 | ✓ |
| Tier: Inner Circle | 20 | ✓ |

The first row is the one that bites today: until Whop is split into per-tier
products, every new buyer sits in that state until someone assigns their tier
role by hand.
