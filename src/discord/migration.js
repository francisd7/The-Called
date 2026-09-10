import { getTierByAirtableValue } from './tiers.js';
import { getBrandByAirtableValue } from './brands.js';
import { CATEGORY_STAFF_ROLES } from './serverStructure.js';

// The one-time pass that gets everyone already in the server onto the new
// roles. This is the only time Airtable seeds Discord - after it, the
// direction reverses permanently and tierSync writes Discord -> Airtable.
//
// Additive only. It never removes a role, including the legacy brand roles,
// because a wrong removal here silently strips someone's access and there is
// no record of what they had. Old roles gate nothing after the restructure,
// so leaving them costs only a stale badge.

// The roles that meant "is a client" before tiers existed. Someone carrying
// one but absent from Airtable is almost certainly a past client: 79 members
// hold `Called Coaches` against 13 active ones.
export const LEGACY_CLIENT_ROLES = ['Called Coaches', 'Called Creators', 'The Called'];

export function clientsByDiscordId(records) {
  const map = new Map();
  for (const record of records) {
    const id = String(record.fields?.['Discord ID'] ?? '').trim();
    if (id) map.set(id, record.fields);
  }
  return map;
}

function selectName(value) {
  return typeof value === 'object' && value !== null ? value.name : value;
}

// Works out what each member should gain. Pure, so the branching that
// decides who becomes a paying client and who becomes a Veteran is testable
// without a live guild - getting this wrong either strips access from a
// paying client or hands the paid areas to someone who left.
export function planRoleAssignments({ members, clients, staffRoleNames = CATEGORY_STAFF_ROLES }) {
  const plan = { clients: [], veterans: [], skipped: [] };

  for (const member of members) {
    const roleNames = member.roleNames ?? [];
    const skip = (reason) => plan.skipped.push({ ...member, reason });

    if (member.bot) {
      skip('bot');
      continue;
    }
    // Staff are never given a tier - they service clients, they aren't one.
    // Someone who is both (Eddie) gets their tier role by hand afterwards.
    if (roleNames.some((name) => staffRoleNames.includes(name))) {
      skip('staff');
      continue;
    }

    const fields = clients.get(member.id);
    if (fields) {
      const tier = getTierByAirtableValue(selectName(fields['Package / Tier']));
      const brand = getBrandByAirtableValue(selectName(fields['Brand']));
      if (!tier) {
        // A client record with no package is a data gap, not a veteran -
        // guessing either way would be wrong, so it goes to a human.
        skip('in Airtable but no Package / Tier recorded');
        continue;
      }
      const add = [brand?.roleName, tier.roleName].filter(
        (name) => name && !roleNames.includes(name)
      );
      plan.clients.push({
        ...member,
        clientName: fields['Client Name'],
        tier: tier.name,
        brand: brand?.name ?? null,
        add,
      });
      continue;
    }

    if (roleNames.some((name) => LEGACY_CLIENT_ROLES.includes(name))) {
      plan.veterans.push({
        ...member,
        add: roleNames.includes('Veteran') ? [] : ['Veteran'],
      });
      continue;
    }

    skip('no Airtable record and no client role');
  }

  return plan;
}

export function formatPlanSummary(plan) {
  const toChange = (entry) => entry.add.length > 0;
  const lines = [];

  lines.push(`Clients (${plan.clients.length}) — brand + tier from Airtable:`);
  for (const entry of plan.clients) {
    const detail = entry.add.length ? entry.add.join(', ') : '(already correct)';
    lines.push(`  ${(entry.displayName ?? entry.id).padEnd(24)} ${entry.tier.padEnd(14)} ${detail}`);
  }

  lines.push('', `Veterans (${plan.veterans.length}) — held a client role, not in Airtable:`);
  for (const entry of plan.veterans) {
    lines.push(`  ${(entry.displayName ?? entry.id).padEnd(24)} ${entry.add.join(', ') || '(already correct)'}`);
  }

  const bySkipReason = new Map();
  for (const entry of plan.skipped) {
    if (!bySkipReason.has(entry.reason)) bySkipReason.set(entry.reason, []);
    bySkipReason.get(entry.reason).push(entry.displayName ?? entry.id);
  }
  lines.push('', `Skipped (${plan.skipped.length}):`);
  for (const [reason, names] of bySkipReason) {
    lines.push(`  ${reason} (${names.length}): ${names.join(', ')}`);
  }

  const changes = [...plan.clients, ...plan.veterans].filter(toChange).length;
  lines.push('', `${changes} member(s) would gain a role.`);
  return lines.join('\n');
}
