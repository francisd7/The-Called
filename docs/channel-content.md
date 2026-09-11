# Channel content

Copy for the channels the structure script created empty. Written to be
pasted into Discord as-is — Discord renders `#`/`##` headers, `**bold**` and
`>` quotes.

Anything in `[square brackets]` needs a real value before posting.

Pin every one of these. A new client arrives via their package's invite link
and lands in `#welcome` with their tier already assigned, so `#start-here` is
what they read within about thirty seconds of paying. It is doing more work
than any other channel here.

---

## `#start-here`

Read by all four tiers *and* by veterans *and* by brand-new buyers who have no
tier role yet — five audiences seeing between 4 and 20 channels. So it never
says "you have X". It says "your sidebar shows what's yours", which is true for
every one of them at once, and lets Discord do the sorting it is already doing.

> Welcome in. Ten minutes here saves you a month of poking around.

**Your sidebar is the map.**

It only shows what your package includes, so it looks different to you than to
the guy next to you. If a section named below isn't in yours, nothing is
broken — it just isn't part of your package yet.

And if the sidebar looks short on your first day, give it a few minutes. Your
access gets switched on shortly after you join.

**Start with your own channel.**

Look down the sidebar for a channel with your name on it — you, your coach,
nobody else. Your welcome message is already sitting in it with your first
tasks. If you only ever use one channel in this server, use that one.

No channel with your name on it? Then `#general-chat` is your room, and that's
where to ask anything.

**Everything else, top to bottom:**

**THE CALLED** — what everybody shares, at every level. `#bible-study`, the
Warrior Huddle voice room, `#general-chat`. This is the brotherhood, not the
business.

**THE FORGE** — where the work happens. Post what you're building in
`#content-review`, pull angles out of `#reel-ideas`, put results in `#wins`.
Read `#wins` even with nothing to post — it's the fastest read in the server on
what's working, and everyone can see it.

**TRAINING HUB** — sales and setting training, conversation reviews, call
recordings.

**Your package's section** — announcements for people on your package only, and
a chat with the guys at exactly your stage.

**Three things to do today:**

1. Say hello in your own channel — or `#general-chat` if you don't have one.
2. Read the last ten posts in `#wins`.
3. Open your welcome message and start on task one.

**Who's who:**

- **Nigel** — founder
- **Francis** — operations. Ask me when something's broken.
- **Andrew** — marketing
- **Noah** — client success, and most likely the name in your channel
- **Eddie** — runs the weekly call

Stuck on anything, post it. Someone will answer.

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

- **`#start-here` first**, before anyone new joins through an invite link.
- **`#start-here` is 1,944 characters — Discord's single-message limit is
  2,000.** It has about one sentence of headroom. Re-count before adding
  anything, or it silently refuses to send.
- Channel names are left in backticks rather than as real `#` mentions.
  Mentions would be clickable, but each costs ~5 more characters against that
  limit, and one pointing at a channel the reader can't see renders greyed out.
  Not worth it here.
- **One name needs checking** — that Eddie's weekly call is still running. Noah
  as CSM is confirmed: the onboarding bot already introduces him by name in
  every welcome message.
- `#start-here` names sections some readers can't see — TRAINING HUB to a
  Foundations client, "your package's section" to a bible-study member. That is
  deliberate. "It just isn't part of your package **yet**" does the upsell
  quietly, without ever ranking anyone. Cut the word "yet" to turn it off.
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
