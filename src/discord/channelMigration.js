import { getTierByAirtableValue } from './tiers.js';
import { selectName } from './migration.js';

// The last piece of the restructure: getting the 19 private client channels
// out of the flat list at the top of the server and into their tier's
// category, with the right staff in each.
//
// Two things have to happen per channel and doing only the first is the bug
// this whole project exists to fix. Re-parenting a channel changes nothing
// about who can see it - a private client channel carries an overwrite the
// category cannot (the client's own access), which desyncs it by definition,
// and Discord resolves an unsynced channel against its OWN overwrites only.
// So dragging every channel into MOMENTUM by hand would look finished and
// leave Andrew and Nigel exactly as locked out as before. The overwrite set
// gets rewritten too, from the same tiers.js staff list tierSync uses.
//
// Everything here is pure so the matching can be tested without a live
// guild. Getting a match wrong here means rewriting the permissions of the
// wrong channel, and there is no undo.

export const NO_TIER = 'no-tier';
export const NO_CHANNEL = 'no-channel';
export const AMBIGUOUS = 'ambiguous';
export const NO_CATEGORY = 'no-category';
export const MISSING_ROLE = 'missing-role';
export const UNEXPECTED_CHANNEL = 'unexpected-channel';

// Matched on the member's own permission overwrite, not on the channel name.
// Names here are display names that change, and several are already stale -
// a rename would strand that client's channel behind where a by-hand pass
// would have caught it.
//
// `declaredChannelIds` is the guard that makes this safe: it holds every
// channel serverStructure.js owns, so a member's overwrite on a shared
// channel (a #wins grant, a leftover per-user exception) can never be
// mistaken for their private one.
function candidateChannelsFor(channels, memberId, declaredChannelIds) {
  return channels.filter(
    (channel) =>
      channel.isText &&
      !declaredChannelIds.has(channel.id) &&
      (channel.overwrites ?? []).some(
        (overwrite) => overwrite.type === 'member' && overwrite.id === memberId
      )
  );
}

export function planClientChannelMoves({
  clients,
  channels,
  declaredChannelIds = new Set(),
  categoryIdByName = new Map(),
  roleIdByName = new Map(),
  guildId,
  botUserId,
}) {
  const moves = [];
  const problems = [];
  const claimed = new Set();

  const flag = (kind, entry) => problems.push({ kind, ...entry });

  for (const [memberId, fields] of clients) {
    const clientName = fields['Client Name'] ?? memberId;
    const tier = getTierByAirtableValue(selectName(fields['Package / Tier']));
    const candidates = candidateChannelsFor(channels, memberId, declaredChannelIds);
    const names = candidates.map((channel) => `#${channel.name}`).join(', ');

    if (!tier) {
      flag(NO_TIER, {
        memberId,
        clientName,
        detail: 'No recognizable Package / Tier in Airtable — nothing to move them to.',
      });
      continue;
    }

    // The Called is bible study only, so a private channel for one is either
    // a leftover from a package they've since dropped or a tier recorded
    // wrong. Both are a human's call, and deleting the channel to match the
    // tier would destroy their history.
    if (!tier.hasPrivateChannel) {
      for (const channel of candidates) claimed.add(channel.id);
      if (candidates.length > 0) {
        flag(UNEXPECTED_CHANNEL, {
          memberId,
          clientName,
          tierName: tier.name,
          detail: `${tier.name} gets no private channel, but ${names} grants them access. Left alone.`,
        });
      }
      continue;
    }

    if (candidates.length === 0) {
      flag(NO_CHANNEL, { memberId, clientName, tierName: tier.name, detail: 'No private channel found.' });
      continue;
    }
    // Never guess which one is theirs - the wrong pick rewrites the
    // permissions of a channel that was fine.
    if (candidates.length > 1) {
      for (const channel of candidates) claimed.add(channel.id);
      flag(AMBIGUOUS, {
        memberId,
        clientName,
        tierName: tier.name,
        detail: `${candidates.length} channels grant them access (${names}). Left alone — move by hand.`,
      });
      continue;
    }

    const channel = candidates[0];
    claimed.add(channel.id);

    const toCategoryId = categoryIdByName.get(tier.categoryName);
    if (!toCategoryId) {
      flag(NO_CATEGORY, {
        memberId,
        clientName,
        tierName: tier.name,
        detail: `Category "${tier.categoryName}" not found — run apply-discord-structure.js first.`,
      });
      continue;
    }

    const staffRoleIds = [];
    const missingRoles = [];
    for (const name of tier.staffRoleNames) {
      const id = roleIdByName.get(name);
      if (id) staffRoleIds.push(id);
      else missingRoles.push(name);
    }
    // Blocking rather than a warning. Writing the channel without the CMO's
    // role is silently the pre-restructure state, and it would read as a
    // success in the output.
    if (missingRoles.length > 0) {
      flag(MISSING_ROLE, {
        memberId,
        clientName,
        tierName: tier.name,
        detail: `Roles missing from the server: ${missingRoles.join(', ')}. Channel left alone.`,
      });
      continue;
    }

    const desiredIds = [guildId, memberId, botUserId, ...staffRoleIds];
    const desired = new Set(desiredIds);

    moves.push({
      memberId,
      clientName,
      tierKey: tier.key,
      tierName: tier.name,
      channelId: channel.id,
      channelName: channel.name,
      fromParentId: channel.parentId ?? null,
      toCategoryId,
      toCategoryName: tier.categoryName,
      staffRoleIds,
      staffRoleNames: tier.staffRoleNames,
      desiredIds,
      parentAlreadyCorrect: channel.parentId === toCategoryId,
      // The overwrites a rewrite would remove. Surfaced because the rewrite
      // replaces the list outright: anyone granted individually who does not
      // also hold one of the tier's staff roles loses access here, and that
      // is worth seeing in the dry run rather than discovering later.
      droppedOverwrites: (channel.overwrites ?? []).filter(
        (overwrite) => !desired.has(overwrite.id)
      ),
    });
  }

  // Undeclared channels with someone's personal grant on them that no active
  // client claimed - almost all past clients. Reported, never touched: this
  // script has no business deciding what happens to a finished client's
  // history.
  const unclaimed = channels.filter(
    (channel) =>
      channel.isText &&
      !declaredChannelIds.has(channel.id) &&
      !claimed.has(channel.id) &&
      (channel.overwrites ?? []).some((overwrite) => overwrite.type === 'member')
  );

  return { moves, problems, unclaimed };
}

export function formatChannelPlan(plan, { categoryNameById = new Map() } = {}) {
  const lines = [];
  const byTier = new Map();
  for (const move of plan.moves) {
    if (!byTier.has(move.tierName)) byTier.set(move.tierName, []);
    byTier.get(move.tierName).push(move);
  }

  for (const [tierName, moves] of byTier) {
    lines.push(`${tierName} (${moves.length}) — staff: ${moves[0].staffRoleNames.join(', ')}:`);
    for (const move of moves) {
      const from = move.parentAlreadyCorrect
        ? 'already in place'
        : `from ${categoryNameById.get(move.fromParentId) ?? 'no category'}`;
      lines.push(`  ${`#${move.channelName}`.padEnd(30)} ${move.clientName.padEnd(22)} ${from}`);
      if (move.droppedOverwrites.length > 0) {
        lines.push(`  ${''.padEnd(30)} drops ${move.droppedOverwrites.length} overwrite(s)`);
      }
    }
    lines.push('');
  }

  if (plan.problems.length > 0) {
    lines.push(`Needs a human (${plan.problems.length}):`);
    for (const problem of plan.problems) {
      lines.push(`  ${problem.clientName.padEnd(22)} [${problem.kind}] ${problem.detail}`);
    }
    lines.push('');
  }

  if (plan.unclaimed.length > 0) {
    lines.push(
      `Unclaimed channels (${plan.unclaimed.length}) — personal grants, no active client. Not touched:`
    );
    for (const channel of plan.unclaimed) {
      lines.push(
        `  ${`#${channel.name}`.padEnd(30)} ${categoryNameById.get(channel.parentId) ?? 'no category'}`
      );
    }
    lines.push('');
  }

  lines.push(`${plan.moves.length} channel(s) to move and re-permission.`);
  return lines.join('\n');
}
