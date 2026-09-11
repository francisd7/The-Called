import { selectName } from '../discord/migration.js';

// The accountability half of the Weekly Check-in reminder. The Friday DM goes
// out and then nothing happens - nobody finds out who ignored it, so a client
// can quietly stop checking in for a month and the first anyone notices is at
// renewal. This posts the miss list to the team on Saturday.
//
// Grouped by CSM on purpose. A flat list of fourteen names is something
// everyone skims and nobody owns; "Noah Freedman (11)" is a to-do list with a
// person's name on it.

// A check-in is matched to a client by the linked record's ID, not by name.
// `Client (Name)` is a formula resolving the link to text, so it follows a
// rename - but the ID cannot drift at all, and a client renamed between
// submitting and the report running would otherwise read as a miss.
function submittedRecordIds(checkinRecords, cutoffIso) {
  const ids = new Set();
  const names = new Set();
  for (const record of checkinRecords) {
    if (cutoffIso && record.createdTime && record.createdTime < cutoffIso) continue;
    const linked = record.fields?.Client;
    if (Array.isArray(linked)) {
      for (const entry of linked) {
        const id = typeof entry === 'string' ? entry : entry?.id;
        if (id) ids.add(id);
      }
    }
    // Name is the fallback for a check-in submitted without the link set -
    // the form can be filled in by someone who isn't matched to a record yet.
    const name = record.fields?.['Client (Name)'];
    if (typeof name === 'string' && name.trim()) names.add(name.trim().toLowerCase());
  }
  return { ids, names };
}

export function buildMissingReport({ clientRecords, checkinRecords, cutoffIso }) {
  const submitted = submittedRecordIds(checkinRecords, cutoffIso);
  const report = { submitted: [], missing: [], notExpected: [] };

  for (const record of clientRecords) {
    const fields = record.fields ?? {};
    const clientName = fields['Client Name'] ?? record.id;

    // The same opt-out the Friday DM honours. Someone who is not expected to
    // check in must not appear as a miss, or the report trains the team to
    // ignore it.
    if (fields['Skip Weekly Reminder'] === true) {
      report.notExpected.push({ clientName, reason: 'opted out' });
      continue;
    }

    const didSubmit =
      submitted.ids.has(record.id) ||
      submitted.names.has(String(clientName).trim().toLowerCase());

    if (didSubmit) {
      report.submitted.push({ recordId: record.id, clientName });
      continue;
    }

    report.missing.push({
      recordId: record.id,
      clientName,
      csm: selectName(fields.CSM) || 'Unassigned',
      // Worth showing: someone with no Discord ID never got the reminder, so
      // their miss is the team's to fix, not theirs.
      hasDiscordId: Boolean(String(fields['Discord ID'] ?? '').trim()),
    });
  }

  report.expectedCount = report.submitted.length + report.missing.length;
  return report;
}

function byCsm(missing) {
  const groups = new Map();
  for (const entry of missing) {
    if (!groups.has(entry.csm)) groups.set(entry.csm, []);
    groups.get(entry.csm).push(entry);
  }
  // Biggest list first, so whoever has the most to chase reads it first.
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

export function formatMissingReport(report, { weekLabel } = {}) {
  const heading = weekLabel
    ? `📋 **Weekly Check-in — who hasn't submitted** (week ending ${weekLabel})`
    : "📋 **Weekly Check-in — who hasn't submitted**";

  if (report.expectedCount === 0) {
    return `${heading}\n\nNo active clients are expected to check in.`;
  }

  if (report.missing.length === 0) {
    return `${heading}\n\n✅ All ${report.expectedCount} checked in. Nothing to chase.`;
  }

  const lines = [
    heading,
    '',
    `**${report.missing.length} of ${report.expectedCount} haven't submitted.**`,
    '',
  ];

  for (const [csm, entries] of byCsm(report.missing)) {
    lines.push(`**${csm}** (${entries.length})`);
    for (const entry of entries) {
      const note = entry.hasDiscordId ? '' : ' — no Discord ID, never got the reminder';
      lines.push(`• ${entry.clientName}${note}`);
    }
    lines.push('');
  }

  if (report.submitted.length > 0) {
    lines.push(
      `✅ Submitted (${report.submitted.length}): ${report.submitted
        .map((entry) => entry.clientName)
        .join(', ')}`
    );
  }

  if (report.notExpected.length > 0) {
    lines.push(
      `Not expected (${report.notExpected.length}): ${report.notExpected
        .map((entry) => entry.clientName)
        .join(', ')}`
    );
  }

  return lines.join('\n');
}
