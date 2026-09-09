// Clients table in "The Called - Client Success" base.
export const CLIENTS_TABLE_ID = 'tblrIOcPpSfDQaHfj';
export const ACTIVE_CLIENTS_FORMULA = "{Status} = 'Active'";

export function formatReminderMessage(fields) {
  const clientName = fields['Client Name'] ?? 'there';
  const link = fields['Weekly Check-in Link'] ?? '';
  return `Hey ${clientName}, time for your Weekly Check-in — ${link}`;
}

// Splits active clients into who'd get a DM and who'd be skipped - matches
// the blueprint's "skip and log it, don't fail silently" branch. A client is
// skipped for one of two independent reasons: "Skip Weekly Reminder" is
// checked (an explicit, permanent opt-out that wins even if a Discord ID is
// on file - e.g. once auto-populated by the future new-member onboarding
// automation), or there's simply no Discord ID on file yet.
export function buildReminderPlan(records) {
  const toSend = [];
  const skipped = [];

  for (const record of records) {
    const fields = record.fields ?? {};
    const clientName = fields['Client Name'] ?? record.id;

    if (fields['Skip Weekly Reminder'] === true) {
      skipped.push({ clientName, reason: 'opted out' });
      continue;
    }

    const discordId = typeof fields['Discord ID'] === 'string' ? fields['Discord ID'].trim() : '';
    if (!discordId) {
      skipped.push({ clientName, reason: 'no Discord ID on file' });
      continue;
    }

    toSend.push({ clientName, discordId, message: formatReminderMessage(fields) });
  }

  return { toSend, skipped };
}

function formatGroup(label, items) {
  const lines = [`${label} (${items.length}):`];
  if (items.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of items) {
      lines.push(`• ${item.clientName}`);
    }
  }
  return lines;
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

  const noDiscordId = plan.skipped.filter((item) => item.reason === 'no Discord ID on file');
  const optedOut = plan.skipped.filter((item) => item.reason === 'opted out');

  lines.push('', ...formatGroup('Skipped, no Discord ID on file', noDiscordId));
  lines.push('', ...formatGroup('Skipped, opted out (Skip Weekly Reminder checked)', optedOut));

  return lines.join('\n');
}
