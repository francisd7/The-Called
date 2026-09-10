# Next session — step by step

Picking up after the Discord restructure went live on 2026-09-10. Everything
structural is done: the 19 private client channels are in their tier
categories with the right staff on each, roles are assigned, `@everyone` no
longer sees the server by default, and tier sync is writing Discord → Airtable.

Six things left, in the order they should be done. A and C are the only ones
with a real deadline attached — the rest can slip.

---

## A. Make the watermark survive deploys

**The problem.** Each polling automation keeps a watermark — the `createdTime`
of the last Airtable record it posted — so it never re-posts. It lives in
`data/state.json`, a file on Railway's disk. Railway's filesystem is
ephemeral, so every deploy wipes it and the log reads:

```
[setterEod] no prior watermark — starting from now
[weeklyCheckin] no prior watermark — starting from now
```

"Starting from now" means anything submitted in the gap between the old
container's last poll and the new container's boot is skipped and never
posted. Polling runs every 60 seconds, so the blind window is roughly one to
three minutes per deploy — and it fires on every deploy and every Railway
restart, not just the branch switch that surfaced it.

The damage is small but silent, which is the part that matters: a missing EOD
looks exactly like a setter who didn't submit one.

**The fix**, config only, no code:

1. Railway → your project → the hub service → **Settings**, and find
   **Volumes** → **Add Volume**. (Railway has moved this between versions; if
   it isn't under Settings, right-click the service on the project canvas, or
   press Cmd/Ctrl+K and search "volume".)
2. Set the **Mount path** to `/data`.
3. Railway → **Variables** → add `STATE_FILE_PATH` = `/data/state.json`.
4. Deploy.

Mounting at `/data` rather than `/app/data` is deliberate: `/app` is the
application directory, and a volume mounted inside it shadows whatever the
build put there. A separate path can't collide.

**Verify.** After this deploy the log will still say `no prior watermark` —
that's expected, the volume is empty on its first boot. Deploy a *second*
time. On that one the "no prior watermark" lines should be **gone**. That's
the proof it persisted; the first deploy alone proves nothing.

---

## B. Check whether anything was lost today

Several deploys went out on 2026-09-10 — the branch switch, the invite map,
and `TIER_SYNC_ENABLED`. Each had a blind window. Probably nothing landed in
one, since EODs and check-ins are sporadic, but it's worth confirming rather
than assuming.

For each table, list the records created on 2026-09-10 and confirm each one
appears in its Discord channel:

| Automation | Base | Table | Posts to |
|---|---|---|---|
| Setter EOD | EOD Reports | `tblAOPJioGyBRliH4` | `DISCORD_SETTER_EOD_CHANNEL_ID` |
| Weekly Check-in | `appkSTSqkeXGHt6pY` | `tblj04VfjlFxoXzL6` | `DISCORD_WEEKLY_CHECKIN_CHANNEL_ID` |

Anything in Airtable with no matching Discord post got dropped in a gap. Post
it by hand — there's no replay mechanism, and adding one for a handful of
records isn't worth the code.

---

## C. Finish the invite rotation

The seven original invite codes went through a chat transcript, so they were
regenerated and the new `DISCORD_INVITE_ROLE_MAP` is already on Railway. Two
steps remain, **in this order**:

1. Replace the old links wherever they're published — Whop, email sequences,
   anything the team sends after a sale.
2. *Then* Server Settings → **Invites** → delete the seven old ones.

Reversing the order breaks anyone mid-purchase. Leaving step 2 undone means a
buyer on a stale link still gets into the server but receives no tier role,
and lands in the onboarding flags channel instead of their tier.

---

## D. Airtable housekeeping

- Delete the **`testing`** record from the 2026-09-09 onboarding test. It is
  the only thing `discord-migrate-channels` still reports as needing a human.
- **Nick Martinez** has `CSM = Unassigned`.
- **Liam McCormack** and **Nathan Soriano** have blank `Contract Value`.
- **Wylie Hawkins** should carry a note marking him 1:1-only, so he isn't
  later mistaken for a missing Inner Circle member. He is $20k fully
  collected, serviced outside Discord entirely, with no Discord ID.

---

## E. Post the channel content

Copy is drafted in `docs/channel-content.md` for `#start-here`, the three
`#<tier>-announcements`, `#foundations-chat` and `#inner-circle-chat`.

`#start-here` first — a new client arrives through their package's invite link
and reads it within about thirty seconds of paying. Pin each one.

Two facts in the copy need checking before it goes up: that **Noah** is the
CSM a new client actually meets, and that **Eddie's weekly call** is still
running.

---

## F. Watch the first real upsell

Tier sync is on and smoke-tested, but the Airtable write and the channel move
have only run against a member with no client record. The first genuine tier
change is the real test.

When one happens, the ops notifications channel should show:

```
📈 **Name** (@them): Foundations → Momentum
Channel #their-channel moved to **MOMENTUM**.
```

Then check Airtable's `Package / Tier` matches, and that their channel is
physically under MOMENTUM with Andrew and Nigel on it.

**Worth building the habit now:** every tier-role click rewrites a billing
field in Airtable, which is exactly why each one posts to that channel. A
line appearing there that nobody expected means a role got changed by hand
somewhere. That channel is the audit trail — muting it removes the only
safeguard on the "Discord wins" design.

---

## Rules this rollout kept re-learning

Both cost a wasted round trip each time they were forgotten:

1. **A channel is judged on its own overwrites, never its category's.** The
   category's list is only a default for channels *synced* to it. A private
   client channel can never be synced — it carries the client's own grant,
   which desyncs it by definition — so moving one between categories changes
   nothing about who can see it. Every move must rewrite the overwrites too.
2. **The same rule in reverse when retiring.** Dragging a channel into a
   locked category does not hide it if the channel carries its own
   overwrites. It needs syncing — safe on a dead channel, destructive on a
   client's, which is what `npm run discord-sync-retired` guards.
