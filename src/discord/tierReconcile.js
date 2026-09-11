import { getTierByAirtableValue, resolveTierFromRoleNames, TIER_ROLE_NAMES } from './tiers.js';
import { selectName } from './migration.js';
import { CATEGORY_STAFF_ROLES } from './serverStructure.js';

// Tier sync listens on guildMemberUpdate and nothing else. If the bot is down
// or mid-deploy when someone clicks a tier role, that event is gone - there is
// no retry and no queue - and Airtable silently stops matching Discord. That
// happened on 2026-09-10 during a redeploy and nothing surfaced it; the record
// was found by reading the table for an unrelated reason.
//
// This is the catch-up. It compares what Discord says against what Airtable
// says and reports every disagreement. Run it after a deploy, or monthly.
//
// It only ever writes Airtable. Discord is the source of truth for tier - it
// is what actually gates access - so a disagreement is always Airtable being
// wrong, never a reason to change someone's roles.

export const WRITE = 'write';
export const NO_TIER_ROLE = 'no-tier-role';
export const NO_TIER_ANYWHERE = 'no-tier-anywhere';
export const NOT_IN_DISCORD = 'not-in-discord';
export const NOT_A_CLIENT = 'not-a-client';

// `recordIdByDiscordId` is passed alongside rather than folded into `clients`
// so clientsByDiscordId stays exactly what the other two migrations already
// depend on. Only this script needs to write back, so only this one needs the
// record id.
export function planTierReconciliation({
  members,
  clients,
  recordIdByDiscordId = new Map(),
  staffRoleNames = CATEGORY_STAFF_ROLES,
}) {
  const plan = {
    writes: [],
    matched: [],
    problems: [],
  };
  const flag = (kind, entry) => plan.problems.push({ kind, ...entry });
  const memberById = new Map(members.map((member) => [member.id, member]));

  for (const [discordId, fields] of clients) {
    const clientName = fields['Client Name'] ?? discordId;
    const member = memberById.get(discordId);

    if (!member) {
      // Left the server, or the Discord ID on the record is wrong. Either way
      // there is no Discord tier to reconcile against, so nothing is written.
      flag(NOT_IN_DISCORD, {
        discordId,
        clientName,
        detail: 'Active in Airtable but not in the server — check the Discord ID.',
      });
      continue;
    }

    const discordTier = resolveTierFromRoleNames(member.roleNames ?? []);
    const airtableTier = getTierByAirtableValue(selectName(fields['Package / Tier']));

    if (!discordTier) {
      // Never blanks Package / Tier. Losing a tier role means losing access,
      // not un-buying the program - the same rule tierSync follows on a role
      // removal, and for the same reason: the record of what someone paid for
      // is not ours to erase.
      flag(airtableTier ? NO_TIER_ROLE : NO_TIER_ANYWHERE, {
        discordId,
        clientName,
        airtableTier: airtableTier?.name ?? null,
        detail: airtableTier
          ? `Airtable says ${airtableTier.name} but they hold no tier role — they can't see their tier's channels.`
          : 'No tier in Discord and none in Airtable — never resolved at onboarding.',
      });
      continue;
    }

    if (airtableTier?.key === discordTier.key) {
      plan.matched.push({ discordId, clientName, tier: discordTier.name });
      continue;
    }

    plan.writes.push({
      discordId,
      clientName,
      recordId: recordIdByDiscordId.get(discordId) ?? null,
      from: airtableTier?.name ?? null,
      to: discordTier.name,
      airtableValue: discordTier.airtableValue,
      // A move that skipped tierSync also skipped the channel move, so the
      // channel is still under the old tier's category with the old staff on
      // it. Writing Airtable is only half the repair.
      needsChannelMove: discordTier.hasPrivateChannel,
    });
  }

  // The other direction: someone carrying a tier role who is not an active
  // client. A veteran who kept their role still reaches the paid areas, and
  // nothing else in the system would ever mention it.
  for (const member of members) {
    if (clients.has(member.id)) continue;
    const roleNames = member.roleNames ?? [];
    if (member.bot) continue;
    if (roleNames.some((name) => staffRoleNames.includes(name))) continue;
    if (!roleNames.some((name) => TIER_ROLE_NAMES.includes(name))) continue;

    flag(NOT_A_CLIENT, {
      discordId: member.id,
      clientName: member.displayName ?? member.id,
      detail: `Holds ${roleNames.filter((n) => TIER_ROLE_NAMES.includes(n)).join(', ')} but is not an active client in Airtable.`,
    });
  }

  return plan;
}

export function formatReconciliation(plan) {
  const lines = [];

  lines.push(`In sync (${plan.matched.length}).`, '');

  lines.push(`Airtable out of date (${plan.writes.length}) — Discord wins:`);
  for (const write of plan.writes) {
    const from = write.from ?? 'nothing';
    lines.push(
      `  ${write.clientName.padEnd(24)} ${from} -> ${write.to}${
        write.needsChannelMove ? '  (channel may also need moving)' : ''
      }`
    );
  }
  if (plan.writes.length === 0) lines.push('  (none)');

  if (plan.problems.length > 0) {
    lines.push('', `Needs a human (${plan.problems.length}):`);
    for (const problem of plan.problems) {
      lines.push(`  ${problem.clientName.padEnd(24)} [${problem.kind}] ${problem.detail}`);
    }
  }

  return lines.join('\n');
}
