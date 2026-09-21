import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isOurEventType, linkedEventTypes } from '../src/lib/offerScope.ts';

const OFFERS = [
  { eventTypeUri: 'https://api.calendly.com/event_types/brotherhood', active: true },
  { eventTypeUri: 'https://api.calendly.com/event_types/branding', active: true },
  { eventTypeUri: 'https://api.calendly.com/event_types/fitness', active: true },
];

test('only the three offer links count as ours', () => {
  const linked = linkedEventTypes(OFFERS);
  assert.equal(linked.size, 3);
  assert.equal(isOurEventType('https://api.calendly.com/event_types/brotherhood', linked), true);
  assert.equal(
    isOurEventType('https://api.calendly.com/event_types/internal-sync', linked),
    false,
    "somebody's own meeting is not a sales call"
  );
});

test('a booking with no event type is not ours', () => {
  const linked = linkedEventTypes(OFFERS);
  assert.equal(isOurEventType(null, linked), false);
  assert.equal(isOurEventType(undefined, linked), false);
  assert.equal(isOurEventType('', linked), false);
});

test('an offer with no linked event type contributes nothing', () => {
  const linked = linkedEventTypes([...OFFERS, { eventTypeUri: null, active: true }]);
  assert.equal(linked.size, 3);
});

test('a retired offer stops counting', () => {
  const linked = linkedEventTypes([
    ...OFFERS,
    { eventTypeUri: 'https://api.calendly.com/event_types/old', active: false },
  ]);
  assert.equal(isOurEventType('https://api.calendly.com/event_types/old', linked), false);
});

test('nothing linked means nothing is ours, rather than everything', () => {
  // The dangerous reading of an empty filter is "let it all through", which is
  // exactly how the whole Calendly account ended up in the lead tracker.
  const linked = linkedEventTypes([{ eventTypeUri: null }, { eventTypeUri: null }]);
  assert.equal(linked.size, 0);
  assert.equal(isOurEventType('https://api.calendly.com/event_types/brotherhood', linked), false);
});
