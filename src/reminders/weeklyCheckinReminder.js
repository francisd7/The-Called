// Clients table in "The Called - Client Success" base.
export const CLIENTS_TABLE_ID = 'tblrIOcPpSfDQaHfj';
export const ACTIVE_CLIENTS_FORMULA = "{Status} = 'Active'";

export function formatReminderMessage(fields) {
  const clientName = fields['Client Name'] ?? 'there';
  const link = fields['Weekly Check-in Link'] ?? '';
  return `Hey ${clientName}, time for your Weekly Check-in — ${link}`;
}

// Splits active clients into who'd get a DM and who'd be skipped (no Discord
// ID on file yet) - matches the blueprint's "skip and log it, don't fail
// silently" branch for automation #3.
export function buildReminderPlan(records) {
  const toSend = [];
  const skipped = [];

  for (const record of records) {
    const fields = record.fields ?? {};
    const clientName = fields['Client Name'] ?? record.id;
    const discordId = typeof fields['Discord ID'] === 'string' ? fields['Discord ID'].trim() : '';

    if (!discordId) {
      skipped.push({ clientName, reason: 'no Discord ID on file' });
      continue;
    }

    toSend.push({ clientName, discordId, message: formatReminderMessage(fields) });
  }

  return { toSend, skipped };
}

export function formatDryRunSummary(plan) {
  const lines = ['🧪 **Weekly Check-in reminder — DRY RUN** (no real DMs sent)', ''];

  lines.push(`Would send (${plan.toSend.length}):`);
  if (plan.toSend.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of plan.toSend) {
      lines.push(`• **${item.clientName}** → "${item.message}"`);
    }
  }

  lines.push('', `Skipped, no Discord ID on file (${plan.skipped.length}):`);
  if (plan.skipped.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of plan.skipped) {
      lines.push(`• ${item.clientName}`);
    }
  }

  return lines.join('\n');
}
