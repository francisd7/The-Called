import { selectName } from '../discord/migration.js';

// Who has not submitted a Weekly Check-in, posted to the team on Saturday.
// Without it a client can quietly stop checking in for a month and the first
// anyone notices is at renewal.
//
// This became the only half on 2026-09-15: the Friday reminder that prompted
// clients was removed at the CSM's request, who prompt them in their 1:1s
// instead. So this is no longer "who ignored the reminder" - nobody is sent
// one - it is simply who has not submitted. Worth keeping in mind when reading
// a long miss list: unprompted is a harder bar than prompted.
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

// `startedAfterDate` is a plain YYYY-MM-DD boundary rather than a timestamp,
// because Start Date is a date-only field - comparing it as a string avoids
// inventing a time of day and then arguing with a timezone about it.
export function buildMissingReport({
  clientRecords,
  checkinRecords,
  cutoffIso,
  startedAfterDate,
}) {
  const submitted = submittedRecordIds(checkinRecords, cutoffIso);
  const report = { submitted: [], missing: [], notExpected: [], tooNew: [] };

  for (const record of clientRecords) {
    const fields = record.fields ?? {};
    const clientName = fields['Client Name'] ?? record.id;

    // Someone who is not expected to check in must not appear as a miss, or
    // the report trains the team to ignore it. The field is still named
    // "Skip Weekly Reminder" in Airtable from when a reminder existed; it now
    // means "not expected to check in at all".
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

    // With the default grace of zero this only catches a client whose Start
    // Date is in the future - someone who has not begun, and so has no week to
    // have missed. Raising the grace also excuses recent joiners, which the
    // team deliberately does not want: a new client's first check-in is the
    // baseline their CSM reads before the onboarding call.
    //
    // A missing Start Date never excuses anyone - that would be a silent way
    // to disappear from the report entirely.
    const startDate = fields['Start Date'];
    if (startedAfterDate && typeof startDate === 'string' && startDate > startedAfterDate) {
      report.tooNew.push({ recordId: record.id, clientName, startDate });
      continue;
    }

    report.missing.push({
      recordId: record.id,
      clientName,
      csm: selectName(fields.CSM) || 'Unassigned',
      // Still worth showing now that no reminder goes out, but for a different
      // reason: an unlinked record is a data gap the team owns. It also means
      // tier sync can't match them, so a role change would never reach their
      // billing field either.
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

  const lines = [heading, ''];

  // The three tails below are appended on every path, including the quiet
  // ones. An early return that skipped them meant a week whose only clients
  // were brand new reported "nobody is expected to check in" while saying
  // nothing about the new clients - the report going quiet exactly when
  // someone needed to know a name.
  if (report.missing.length === 0) {
    lines.push(
      report.expectedCount === 0
        ? 'No check-ins were expected this week.'
        : `✅ All ${report.expectedCount} checked in. Nothing to chase.`
    );
  } else {
    lines.push(`**${report.missing.length} of ${report.expectedCount} haven't submitted.**`, '');

    for (const [csm, entries] of byCsm(report.missing)) {
      lines.push(`**${csm}** (${entries.length})`);
      for (const entry of entries) {
        const note = entry.hasDiscordId ? '' : ' — no Discord ID on file';
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
  }

  if (report.tooNew.length > 0) {
    lines.push(
      `🆕 Not expected yet (${report.tooNew.length}): ${report.tooNew
        .map((entry) => `${entry.clientName} — starts ${entry.startDate}`)
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
