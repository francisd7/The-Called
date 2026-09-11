import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from '../src/automations/postCall.js';
import { TIERS } from '../src/discord/tiers.js';

function record(fields) {
  return { fields };
}

test('a closed call leads with the outcome and carries the money', () => {
  const message = formatMessage(
    record({
      'Lead Name': 'Jane Doe',
      Date: '2026-09-10',
      Closer: 'Andrew',
      'Setter Booked': 'Alexis',
      'Call Outcome': 'Closed',
      'Payment Method': 'Klarna',
      'Cash Collected': 3000,
      Revenue: 10000,
    })
  );
  assert.match(message, /🎉 \*\*Closed\*\* — Jane Doe/);
  assert.match(message, /Andrew closing · booked by Alexis · Sep 10/);
  assert.match(message, /💰 \$3,000 collected · \$10,000 revenue · via Klarna/);
});

test('each outcome gets its own icon so a channel reads at a glance', () => {
  const icons = {
    Closed: '🎉',
    'No Show': '👻',
    'No Close': '❌',
    Rescheduled: '📅',
    'Follow Up Scheduled': '🔁',
  };
  for (const [outcome, icon] of Object.entries(icons)) {
    assert.match(formatMessage(record({ 'Call Outcome': outcome })), new RegExp(`^${icon} `));
  }
});

test('an unrecognised outcome still posts rather than breaking', () => {
  assert.match(formatMessage(record({ 'Call Outcome': 'Something New' })), /^📞 \*\*Something New\*\*/);
  assert.match(formatMessage(record({})), /^📞 \*\*Logged\*\* — Unnamed lead/);
});

test('a call that produced no money prints no money line', () => {
  // A row of "$0 collected" is the kind of line people learn to skip, and
  // then they miss the night it isn't zero.
  const message = formatMessage(
    record({ 'Lead Name': 'Jane Doe', 'Call Outcome': 'No Show', 'Cash Collected': 0, Revenue: 0 })
  );
  assert.doesNotMatch(message, /💰/);
});

test('"No Close" as a payment method is not printed as one', () => {
  // It is an outcome wearing a payment method's clothes - "via No Close"
  // would be nonsense.
  const message = formatMessage(
    record({ 'Call Outcome': 'Closed', Revenue: 5000, 'Payment Method': 'No Close' })
  );
  assert.match(message, /💰 \$5,000 revenue/);
  assert.doesNotMatch(message, /via No Close/);
});

test('a single select arriving as an object resolves to its name', () => {
  const message = formatMessage(
    record({ 'Call Outcome': { id: 'sel1', name: 'Closed' }, Closer: { id: 'sel2', name: 'Nigel' } })
  );
  assert.match(message, /🎉 \*\*Closed\*\*/);
  assert.match(message, /Nigel closing/);
});

test('notes are truncated but a recording link is left whole', () => {
  // Half a URL is worse than none.
  const link = `https://fathom.video/share/${'x'.repeat(60)}`;
  const message = formatMessage(
    record({ 'Call Outcome': 'Closed', Notes: 'n'.repeat(900), 'Fathom Recording': link })
  );
  assert.match(message, /…/);
  assert.ok(message.includes(link));
  assert.ok(message.length < 2000, 'must fit in a Discord message');
});

test('partial attribution still reads correctly', () => {
  const message = formatMessage(record({ 'Call Outcome': 'Closed', 'Setter Booked': 'Loui' }));
  assert.match(message, /^🎉 \*\*Closed\*\* — Unnamed lead\nbooked by Loui$/);
});

test('the tier sold sits in the headline', () => {
  // "What did we just sell" is the second thing you want after "did it close".
  const message = formatMessage(
    record({ 'Lead Name': 'Marcus Webb', 'Call Outcome': 'Closed', Tier: 'Momentum' })
  );
  assert.match(message, /^🎉 \*\*Closed\*\* — Marcus Webb · \*\*Momentum\*\*$/m);
});

test('a tier still shows on a call that did not close', () => {
  // What they were pitched is worth knowing on a miss.
  const message = formatMessage(
    record({ 'Lead Name': 'Devon Hart', 'Call Outcome': 'No Show', Tier: 'Inner Circle' })
  );
  assert.match(message, /👻 \*\*No Show\*\* — Devon Hart · \*\*Inner Circle\*\*/);
});

test('"No Close" as a tier is suppressed, like it is as a payment method', () => {
  // Same sentinel in both fields - an outcome wearing another field's
  // clothes. "Closed · No Close" is nonsense and the outcome already said it.
  const message = formatMessage(
    record({ 'Lead Name': 'Devon Hart', 'Call Outcome': 'No Close', Tier: 'No Close' })
  );
  assert.match(message, /^❌ \*\*No Close\*\* — Devon Hart$/m);
});

test('a tier arriving as an object resolves to its name', () => {
  const message = formatMessage(
    record({ 'Call Outcome': 'Closed', Tier: { id: 'sel1', name: 'Foundations' } })
  );
  assert.match(message, /\*\*Foundations\*\*/);
});

test('the four sellable tiers match the ladder the rest of the system uses', () => {
  // The Post Call form is the one place a tier is typed by hand rather than
  // resolved from tiers.js, so it can drift silently - it said "Foundation"
  // for a day. Nothing joins the two today, but anything that ever compares
  // what was sold against what a client holds would quietly find no match.
  for (const tier of TIERS) {
    const message = formatMessage(record({ 'Call Outcome': 'Closed', Tier: tier.name }));
    assert.match(message, new RegExp(`\\*\\*${tier.name}\\*\\*`), tier.name);
  }
});
