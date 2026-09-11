import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstNameOf,
  formatReminderMessage,
  buildReminderPlan,
  formatDryRunSummary,
} from '../src/reminders/weeklyCheckinReminder.js';

test('firstNameOf takes just the first word, with sensible fallbacks', () => {
  assert.equal(firstNameOf('Jane Doe'), 'Jane');
  assert.equal(firstNameOf('  Extra  Space   Name'), 'Extra');
  assert.equal(firstNameOf('Cher'), 'Cher');
  assert.equal(firstNameOf(''), 'there');
  assert.equal(firstNameOf(undefined), 'there');
});

test('the reminder carries the configured form link', () => {
  assert.equal(
    formatReminderMessage({ 'Client Name': 'Jane Doe' }, { formUrl: 'https://airtable.com/form' }),
    'Hey Jane, time for your Weekly Check-in — https://airtable.com/form'
  );
});

test('no configured form means no dangling dash', () => {
  // The old message read a `Weekly Check-in Link` field that has never existed
  // on the Clients table, so every reminder ever sent ended in "—" and
  // nothing.
  assert.equal(
    formatReminderMessage({ 'Client Name': 'Jane Doe' }),
    'Hey Jane, time for your Weekly Check-in.'
  );
});

test('buildReminderPlan splits clients with and without a Discord ID', () => {
  const records = [
    {
      id: 'rec1',
      fields: {
        'Client Name': 'Has Id',
        'Discord ID': '123456789012345678',
        'Weekly Check-in Link': 'https://airtable.com/1',
      },
    },
    {
      id: 'rec2',
      fields: { 'Client Name': 'No Id' },
    },
    {
      id: 'rec3',
      fields: { 'Client Name': 'Blank Id', 'Discord ID': '   ' },
    },
  ];

  const plan = buildReminderPlan(records);

  assert.equal(plan.toSend.length, 1);
  assert.equal(plan.toSend[0].clientName, 'Has Id');
  assert.equal(plan.toSend[0].discordId, '123456789012345678');
  // Mentioned, not named. The reminder is posted into the client's own
  // channel now, and a mention is the part that actually notifies them.
  assert.match(
    plan.toSend[0].message,
    /^Hey <@123456789012345678>, time for your Weekly Check-in/
  );

  assert.deepEqual(
    plan.skipped.map((s) => ({ clientName: s.clientName, reason: s.reason })),
    [
      { clientName: 'No Id', reason: 'no Discord ID on file' },
      { clientName: 'Blank Id', reason: 'no Discord ID on file' },
    ]
  );
});

test('buildReminderPlan: "Skip Weekly Reminder" wins even when a Discord ID is on file', () => {
  const records = [
    {
      id: 'rec1',
      fields: {
        'Client Name': 'Opted Out',
        'Discord ID': '123456789012345678',
        'Skip Weekly Reminder': true,
      },
    },
  ];

  const plan = buildReminderPlan(records);

  assert.equal(plan.toSend.length, 0);
  assert.deepEqual(plan.skipped, [{ clientName: 'Opted Out', reason: 'opted out' }]);
});

test('formatDryRunSummary lists all three groups, with a "(none)" fallback', () => {
  const summary = formatDryRunSummary({ toSend: [], skipped: [] });
  assert.match(summary, /DRY RUN/);
  assert.match(summary, /Would send \(0\):\n {2}\(none\)/);
  assert.match(summary, /no Discord ID on file \(0\):\n {2}\(none\)/);
  assert.match(summary, /opted out \(Skip Weekly Reminder checked\) \(0\):\n {2}\(none\)/);
});

test('a mention replaces the first name, and the link is unaffected', () => {
  const fields = { 'Client Name': 'Jane Doe' };
  const opts = { formUrl: 'https://x/form' };
  assert.match(formatReminderMessage(fields, opts), /^Hey Jane,/);
  assert.equal(
    formatReminderMessage(fields, { ...opts, mention: '<@9>' }),
    'Hey <@9>, time for your Weekly Check-in — https://x/form'
  );
});
