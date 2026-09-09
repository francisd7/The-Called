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

test('formats the reminder message using only the first name', () => {
  const fields = {
    'Client Name': 'Jane Doe',
    'Weekly Check-in Link': 'https://airtable.com/example',
  };
  assert.equal(
    formatReminderMessage(fields),
    'Hey Jane, time for your Weekly Check-in — https://airtable.com/example'
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
  assert.match(plan.toSend[0].message, /^Hey Has, time for your Weekly Check-in/);

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
