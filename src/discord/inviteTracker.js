// Works out which invite link a new member used, since Discord's join event
// doesn't say. The trick is bookkeeping: keep every invite's use count, and
// when someone joins, re-fetch and find the one that went up by one.
//
// It is inference, not a guarantee, so every ambiguous case resolves to null
// with a reason rather than a guess - onboarding then flags it for a human
// instead of quietly handing out the wrong tier.

export const RESOLVED = 'resolved';
export const NO_CHANGE = 'no-change';
export const AMBIGUOUS = 'ambiguous';

// `before` and `after` are Maps of invite code -> use count.
export function diffInviteUses(before, after) {
  const candidates = [];

  for (const [code, uses] of after) {
    const previous = before.get(code);
    // A code we've never seen carries no evidence on its own: the apply
    // script creates invites at 0 uses, and a fresh snapshot after a restart
    // would otherwise make every existing invite look newly used.
    if (previous === undefined) {
      if (uses > 0 && before.size > 0) candidates.push(code);
      continue;
    }
    if (uses > previous) candidates.push(code);
  }

  // An invite that hit its max uses is deleted by Discord the moment it's
  // consumed, so it vanishes from `after` rather than incrementing. Only
  // relevant if one-time invites get adopted later, but cheap to handle now.
  for (const code of before.keys()) {
    if (!after.has(code)) candidates.push(code);
  }

  if (candidates.length === 1) return { code: candidates[0], reason: RESOLVED };
  if (candidates.length === 0) return { code: null, reason: NO_CHANGE };
  return { code: null, reason: AMBIGUOUS };
}

export function toUsesMap(invites) {
  const map = new Map();
  for (const invite of invites) {
    map.set(invite.code, invite.uses ?? 0);
  }
  return map;
}

// `fetchInvites` is injected so the diffing above can be unit tested without
// a live guild - same boundary the rest of this hub draws around discord.js.
export function createInviteTracker({ fetchInvites, log = console }) {
  let cache = new Map();
  let primed = false;

  // Joins are handled one at a time. Two members joining inside the same
  // fetch window would otherwise both see the same +2 diff and both resolve
  // to AMBIGUOUS; serialising means the first one's snapshot becomes the
  // second one's baseline and each still resolves cleanly.
  let queue = Promise.resolve();

  async function refresh() {
    const invites = await fetchInvites();
    cache = toUsesMap(invites);
    primed = true;
    return cache;
  }

  async function prime() {
    try {
      await refresh();
      log.info(`[inviteTracker] primed with ${cache.size} invites`);
    } catch (err) {
      // Not fatal: an unprimed tracker resolves every join to NO_CHANGE,
      // which flags for manual assignment rather than blocking the join.
      log.error('[inviteTracker] failed to prime invite cache:', err);
    }
  }

  function resolveForJoin() {
    const run = queue.then(async () => {
      if (!primed) {
        // The bot was down or never primed, so there's no baseline to
        // compare against. Take this snapshot as the new baseline so the
        // *next* join resolves, and flag this one.
        await refresh().catch(() => {});
        return { code: null, reason: NO_CHANGE };
      }

      const before = cache;
      let after;
      try {
        after = await refresh();
      } catch (err) {
        log.error('[inviteTracker] failed to fetch invites on join:', err);
        return { code: null, reason: NO_CHANGE };
      }
      return diffInviteUses(before, after);
    });

    // Keep the chain alive even if one link rejects, or a single failure
    // would wedge every later join behind it.
    queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  return { prime, resolveForJoin, refresh, get isPrimed() { return primed; } };
}
