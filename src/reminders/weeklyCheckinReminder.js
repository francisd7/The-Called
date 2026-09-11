// Clients table in "The Called - Client Success" base.
export const CLIENTS_TABLE_ID = 'tblrIOcPpSfDQaHfj';
export const ACTIVE_CLIENTS_FORMULA = "{Status} = 'Active'";

export function firstNameOf(fullName) {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

// The form is one shared URL, not a per-client field. This used to read a
// `Weekly Check-in Link` field off the Client record; no such field has ever
// existed on that table, so every reminder ever sent ended in a dangling em
// dash with nothing after it - including the twenty DMs on 2026-09-11.
//
// The client's name is prefilled into the form so they don't have to find
// themselves in a dropdown. That is not cosmetic: the check-in links back to
// their Client record, and a check-in submitted without that link cannot be
// matched, so it counts as missing in Saturday's report no matter what they
// wrote.
export function buildCheckinLink(formUrl, clientName) {
  if (!formUrl) return '';
  if (!clientName) return formUrl;
  const separator = formUrl.includes('?') ? '&' : '?';
  return `${formUrl}${separator}prefill_Client=${encodeURIComponent(clientName)}`;
}

// A mention replaces the first name when this is posted into a channel: it
// reads the same and it actually notifies them, which a plain name does not.
export function formatReminderMessage(fields, { mention, formUrl } = {}) {
  const who = mention || firstNameOf(fields['Client Name']);
  const link = buildCheckinLink(formUrl, fields['Client Name']);
  // No link means no trailing dash. A sentence that ends in "—" and nothing
  // else reads as broken, which is exactly how it read.
  return link
    ? `Hey ${who}, time for your Weekly Check-in — ${link}`
    : `Hey ${who}, time for your Weekly Check-in.`;
}

// Splits active clients into who'd get a DM and who'd be skipped - matches
// the blueprint's "skip and log it, don't fail silently" branch. A client is
// skipped for one of two independent reasons: "Skip Weekly Reminder" is
// checked (an explicit, permanent opt-out that wins even if a Discord ID is
// on file - e.g. once auto-populated by the future new-member onboarding
// automation), or there's simply no Discord ID on file yet.
export function buildReminderPlan(records, { formUrl } = {}) {
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

    toSend.push({
      clientName,
      discordId,
      message: formatReminderMessage(fields, { mention: `<@${discordId}>`, formUrl }),
    });
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
